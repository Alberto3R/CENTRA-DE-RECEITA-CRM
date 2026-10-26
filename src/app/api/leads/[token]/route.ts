import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { brPhoneLookupKeys } from '@/lib/whatsapp/phone-utils'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { marcarContatoComTag } from '@/lib/contacts/marcar-tag'
import { extractAttribution } from '@/lib/attribution/extract'

// ============================================================
// POST /api/leads/[token] — captação de lead por formulário, self-service
// por conta. O token na URL identifica a config (lead_capture_config):
// conta + funil + etapa FIXA (1 form = 1 etapa). Cria/acha o contato
// (dedup por telefone, já com o 55) e abre um negócio na etapa configurada —
// ou reaproveita o negócio aberto do mesmo contato no mesmo funil, quando a
// pessoa preenche o formulário de novo.
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

/** Corpo do template com {{1}}, {{2}}… trocados — vira o balão no inbox. */
function renderBody(body: string | null | undefined, params: string[]): string | null {
  if (!body) return null
  return body.replace(/\{\{(\d+)\}\}/g, (m, n) => params[Number(n) - 1] ?? m)
}

/**
 * Conversa do contato neste canal: a mais recente, ou uma nova. A boas-vindas
 * precisa de conversa para ficar registrada no inbox — sem ela o vendedor não
 * vê o que o lead recebeu. Corrida com o webhook: o índice único (migração
 * 119) recusa a duplicata e a gente relê.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findOrCreateConversation(db: any, accountId: string, userId: string, contactId: string, channelId: string) {
  const find = () =>
    db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('channel_id', channelId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
  const { data: existing } = await find()
  if (existing) return existing.id as string
  const { data: created, error } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: userId, contact_id: contactId, channel_id: channelId })
    .select('id')
    .single()
  if (created) return created.id as string
  if (error) {
    const { data: raced } = await find()
    if (raced) return raced.id as string
  }
  return null
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

  const givenName = str(a.nome) ?? str(a.name)
  const name = givenName ?? 'Lead (formulário)'
  const phoneRaw = str(a.phone_e164) ?? str(a.whatsapp) ?? str(a.telefone) ?? str(a.phone)
  if (!phoneRaw) return NextResponse.json({ ok: false, error: 'missing phone' }, { status: 400 })
  // Formulário brasileiro manda "(81) 99999-1234": sem o 55 a Meta lê o DDD
  // como país e o lead nunca recebe nada. A 1ª chave é a canônica (com 55);
  // a 2ª acha o contato gravado antes desta correção, ainda sem o 55.
  const phoneKeys = brPhoneLookupKeys(phoneRaw)
  const phone = phoneKeys[0]
  if (!phone) return NextResponse.json({ ok: false, error: 'missing phone' }, { status: 400 })
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

  // Contato — dedup por phone_normalized (mesma chave do resto do CRM),
  // pela forma canônica e pela antiga sem 55. Se só existir a antiga, ela
  // ganha o 55 aqui, para a resposta do lead no WhatsApp cair nela.
  let contactId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findByKeys = async (): Promise<any | null> => {
    const { data: rows } = await db
      .from('contacts')
      .select('id, name, email, phone_normalized')
      .eq('account_id', cfg.account_id)
      .in('phone_normalized', phoneKeys)
    const list = (rows ?? []) as Array<{ phone_normalized: string }>
    list.sort((x, y) => phoneKeys.indexOf(x.phone_normalized) - phoneKeys.indexOf(y.phone_normalized))
    return list[0] ?? null
  }
  const existing = await findByKeys()
  if (existing) {
    contactId = existing.id
    const patch: Record<string, string> = {}
    if (!existing.name && givenName) patch.name = givenName
    if (!existing.email && email) patch.email = email
    if (existing.phone_normalized !== phone) patch.phone = phone
    if (Object.keys(patch).length) {
      const { error: upErr } = await db.from('contacts').update(patch).eq('id', contactId)
      // Já existe outro contato com o número canônico (índice único): deixa o
      // telefone como está e grava só o resto.
      if (upErr && patch.phone) {
        delete patch.phone
        if (Object.keys(patch).length) await db.from('contacts').update(patch).eq('id', contactId)
      }
    }
  } else {
    const { data: created, error: cErr } = await db
      .from('contacts')
      .insert({
        account_id: cfg.account_id,
        user_id: ownerId,
        phone,
        name,
        email,
        company: str(a.empresa) ?? str(a.segmento),
      })
      .select('id')
      .single()
    if (cErr || !created) {
      // corrida de dedup: re-busca
      const again = await findByKeys()
      if (!again) return NextResponse.json({ ok: false, error: 'contact insert failed' }, { status: 500 })
      contactId = again.id
    } else {
      contactId = created.id
    }
  }

  // Tag de identificação da config (migration 109) — vale também para quem
  // já era contato. Best-effort: nunca derruba a captação.
  try {
    await marcarContatoComTag(db, cfg.account_id, contactId, cfg.default_tag_id)
  } catch (e) {
    console.error('[leads/token] tag falhou', e)
  }

  // Negócio: quem preenche de novo já tem um aberto neste funil — reaproveita
  // em vez de abrir outro (um lead chegou a ter 4 negócios iguais). O reenvio
  // fica no histórico do negócio. Senão, abre na etapa fixa da config.
  const { data: openDeal } = await db
    .from('deals')
    .select('id')
    .eq('account_id', cfg.account_id)
    .eq('contact_id', contactId)
    .eq('pipeline_id', cfg.pipeline_id)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const reused = Boolean(openDeal?.id)
  let dealId: string | null = openDeal?.id ?? null
  if (!reused) {
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
    dealId = deal?.id ?? null
  }

  // Atribuição (UTMs + payload bruto) — best-effort, nunca derruba a resposta.
  // UTM/fbclid vêm do corpo ou, se a landing não mandar, da query string da
  // URL da página (landing_url / event_source_url / Referer).
  const attr = extractAttribution(a, request.headers.get('referer'))
  try {
    await db.from('lead_attribution').insert({
      account_id: cfg.account_id,
      contact_id: contactId,
      deal_id: dealId,
      source: str(a.origem) ?? 'form',
      ...attr,
      raw: a,
    })
  } catch (e) {
    console.error('[leads/token] attribution falhou', e)
  }

  // Histórico do negócio (deal_events, migration 081) com origem/UTM/payload.
  // Negócio novo: enriquece o evento 'created' — vira o "Negócio criado via
  // integração → Mostrar dados". Reenvio: registra 'form_resubmitted'.
  // Best-effort: nunca derruba a resposta.
  if (dealId) {
    const metadata = {
      integration: cfg.name ?? 'Captação de lead',
      origem: str(a.origem) ?? 'form',
      utm_source: attr.utm_source,
      utm_medium: attr.utm_medium,
      utm_campaign: attr.utm_campaign,
      utm_content: attr.utm_content,
      utm_term: attr.utm_term,
      landing_url: attr.landing_url,
      payload: a,
    }
    try {
      if (reused) {
        await db.from('deal_events').insert({
          deal_id: dealId,
          account_id: cfg.account_id,
          type: 'form_resubmitted',
          metadata,
        })
      } else {
        await db
          .from('deal_events')
          .update({ type: 'created_via_integration', metadata })
          .eq('deal_id', dealId)
          .eq('type', 'created')
      }
    } catch (e) {
      console.error('[leads/token] deal_event falhou', e)
    }
  }

  // Mensagem de abertura (template aprovado), se configurada — só para lead
  // novo (quem reenvia o formulário não recebe de novo). Sai pelo mesmo
  // caminho das automações, que grava o balão na conversa: o vendedor vê no
  // inbox o que o lead recebeu. Best-effort.
  let welcomeSent = false
  if (cfg.welcome_template && !reused) {
    try {
      const wa = await resolveChannelConfig(db, cfg.account_id)
      if (wa?.id) {
        const { data: tpl } = await db
          .from('message_templates')
          .select('status, language, body_text')
          .eq('channel_id', wa.id)
          .eq('name', cfg.welcome_template)
          .maybeSingle()
        if (tpl?.status === 'APPROVED') {
          const conversationId = await findOrCreateConversation(db, cfg.account_id, ownerId, contactId, wa.id)
          if (conversationId) {
            const firstName = givenName?.split(/\s+/)[0] || 'tudo bem'
            await engineSendTemplate({
              accountId: cfg.account_id,
              userId: ownerId,
              conversationId,
              contactId,
              templateName: cfg.welcome_template,
              language: (tpl.language as string) || 'pt_BR',
              params: [firstName],
              contentText: renderBody(tpl.body_text as string | null, [firstName]),
            })
            welcomeSent = true
          }
        }
      }
    } catch (e) {
      console.error('[leads/token] welcome falhou', e)
    }
  }

  return NextResponse.json(
    { ok: true, contact_id: contactId, deal_id: dealId, reused_deal: reused, welcome_sent: welcomeSent },
    { status: 200 },
  )
}
