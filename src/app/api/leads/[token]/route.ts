import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'

// ============================================================
// POST /api/leads/[token] — captação de lead por formulário, self-service
// por conta. O token na URL identifica a config (lead_capture_config):
// conta + funil + etapa FIXA (1 form = 1 etapa). Cria/acha o contato
// (dedup por telefone) e abre um negócio na etapa configurada.
//
// Paralelo ao gateway de pagamento. NÃO substitui /api/leads (fluxo por
// env da Sales 3R/AUGRA, com gate de qualificação) — este é o caminho novo,
// por conta, sem env e sem gate.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const db = admin()

  const { data: cfg } = await db
    .from('lead_capture_config')
    .select('*')
    .eq('token', token)
    .eq('enabled', true)
    .maybeSingle()
  if (!cfg) return NextResponse.json({ ok: false, error: 'config_not_found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let a: Record<string, any>
  try {
    a = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const name = str(a.nome) ?? str(a.name) ?? 'Lead (formulário)'
  const phoneRaw = str(a.phone_e164) ?? str(a.whatsapp) ?? str(a.telefone) ?? str(a.phone)
  if (!phoneRaw) return NextResponse.json({ ok: false, error: 'missing phone' }, { status: 400 })
  const phone = normalizePhone(phoneRaw)
  const email = str(a.email)

  const { data: acc } = await db
    .from('accounts')
    .select('owner_user_id, default_currency')
    .eq('id', cfg.account_id)
    .maybeSingle()
  const ownerId = acc?.owner_user_id
  if (!ownerId) return NextResponse.json({ ok: false, error: 'account owner missing' }, { status: 500 })
  if (!cfg.pipeline_id) return NextResponse.json({ ok: false, error: 'no pipeline' }, { status: 500 })

  // Etapa: a fixa da config, ou a 1ª do funil se não houver.
  let stageId: string | null = cfg.stage_id
  if (!stageId) {
    const { data: first } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', cfg.pipeline_id)
      .order('position')
      .limit(1)
      .maybeSingle()
    stageId = first?.id ?? null
  }

  // Contato — dedup por phone_normalized (mesma chave do resto do CRM).
  let contactId: string
  const { data: existing } = await db
    .from('contacts')
    .select('id, name, email')
    .eq('account_id', cfg.account_id)
    .eq('phone_normalized', phone)
    .maybeSingle()
  if (existing) {
    contactId = existing.id
    const patch: Record<string, string> = {}
    if (!existing.name && name) patch.name = name
    if (!existing.email && email) patch.email = email
    if (Object.keys(patch).length) await db.from('contacts').update(patch).eq('id', contactId)
  } else {
    const { data: created, error: cErr } = await db
      .from('contacts')
      .insert({
        account_id: cfg.account_id,
        user_id: ownerId,
        phone: phoneRaw,
        name,
        email,
        company: str(a.empresa) ?? str(a.segmento),
      })
      .select('id')
      .single()
    if (cErr || !created) {
      // corrida de dedup: re-busca
      const { data: again } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', cfg.account_id)
        .eq('phone_normalized', phone)
        .maybeSingle()
      if (!again) return NextResponse.json({ ok: false, error: 'contact insert failed' }, { status: 500 })
      contactId = again.id
    } else {
      contactId = created.id
    }
  }

  // Negócio na etapa fixa da config.
  const { data: deal } = await db
    .from('deals')
    .insert({
      account_id: cfg.account_id,
      user_id: ownerId,
      pipeline_id: cfg.pipeline_id,
      stage_id: stageId,
      contact_id: contactId,
      title: `${name} — Formulário`,
      status: 'open',
      currency: acc?.default_currency ?? 'BRL',
      notes: str(a.mensagem) ? `Formulário: ${str(a.mensagem)}` : null,
    })
    .select('id')
    .single()
  const dealId = deal?.id ?? null

  // Atribuição (UTMs + payload bruto) — best-effort, nunca derruba a resposta.
  await db
    .from('lead_attribution')
    .insert({
      account_id: cfg.account_id,
      contact_id: contactId,
      deal_id: dealId,
      source: str(a.origem) ?? 'form',
      utm_source: str(a.utm_source),
      utm_medium: str(a.utm_medium),
      utm_campaign: str(a.utm_campaign),
      utm_content: str(a.utm_content),
      utm_term: str(a.utm_term),
      landing_url: str(a.event_source_url) ?? str(a.landing_url),
      raw: a,
    })
    .catch(() => {})

  // Mensagem de abertura (template aprovado), se configurada — best-effort.
  if (cfg.welcome_template) {
    try {
      const wa = await resolveChannelConfig(db, cfg.account_id)
      if (wa?.phone_number_id && wa?.access_token) {
        const { data: tpl } = await db
          .from('message_templates')
          .select('status, language')
          .eq('channel_id', wa.id)
          .eq('name', cfg.welcome_template)
          .maybeSingle()
        if (tpl?.status === 'APPROVED') {
          const firstName = (name || '').trim().split(/\s+/)[0] || 'tudo bem'
          await sendTemplateMessage({
            phoneNumberId: wa.phone_number_id as string,
            accessToken: decrypt(wa.access_token as string),
            to: phone,
            templateName: cfg.welcome_template,
            language: (tpl.language as string) || 'pt_BR',
            params: [firstName],
          })
        }
      }
    } catch (e) {
      console.error('[leads/token] welcome falhou', e)
    }
  }

  return NextResponse.json({ ok: true, contact_id: contactId, deal_id: dealId }, { status: 200 })
}
