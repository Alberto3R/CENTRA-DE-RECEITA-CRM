import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { decrypt } from '@/lib/whatsapp/encryption'
import { notifyTeamNewLead } from '@/lib/notifications/lead-alert'

// ============================================================
// /api/meta/leadgen — webhook de Lead Ads (formulário nativo da Meta)
//
// GET  = verificação da assinatura do webhook (hub.challenge). O verify
//        token fica em app_config('leadgen_verify_token') — sem env nova.
// POST = evento `leadgen`: busca o lead na Graph (field_data), cria/acha o
//        contato (dedup por phone_normalized), abre o deal no pipeline da
//        campanha já no estágio da classificação (gate), e grava o vínculo
//        em meta_leadgen_leads (leadgen_id ↔ deal) — chave da devolução de
//        conversões pro dataset (worker /api/meta/leadgen/conversions).
//
// Auth do POST: HMAC x-hub-signature-256 contra a lista META_APP_SECRET
// (mesma validação do webhook de WhatsApp).
// ============================================================

const GRAPH = 'https://graph.facebook.com/v21.0'

// WABA cujo token (system user Sales 3R) lê páginas/leads — mesmo padrão
// do /api/meta-capi (token cifrado no whatsapp_config; nada em texto).
const TOKEN_WABA = '824812527258696'

// página → destino no CRM. (Campanha CCC: página Alberto Oliveira.)
const PAGE_ROUTES: Record<string, { accountId: string; pipeline: string; origem: string }> = {
  '152902442083026': {
    accountId: 'fd9b374f-e140-4bd4-8200-f8663fb09705', // conta Sales 3R
    pipeline: 'Tráfego Pago',
    origem: 'meta-leadform-ccc',
  },
}

// classificação (gate do formulário) → estágio do pipeline
const STAGE_BY_FIT: Record<string, string> = {
  verde: 'Qualificado (verde)',
  amarelo: 'Em avaliação (amarelo)',
  vermelho: 'Off-gate / Perdido',
}

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

async function appConfig(key: string): Promise<string | null> {
  const { data } = await admin().from('app_config').select('value').eq('key', key).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}

// token do system user (cifrado no canal) → page access token
async function pageToken(pageId: string): Promise<string | null> {
  const { data } = await admin()
    .from('whatsapp_config')
    .select('access_token')
    .eq('waba_id', TOKEN_WABA)
    .eq('status', 'connected')
    .not('access_token', 'is', null)
    .limit(1)
    .maybeSingle()
  if (!data?.access_token) return null
  let sysToken: string
  try {
    sysToken = decrypt(data.access_token as string)
  } catch {
    return null
  }
  try {
    const res = await fetch(
      `${GRAPH}/${pageId}?fields=access_token&access_token=${encodeURIComponent(sysToken)}`,
    )
    if (!res.ok) return null
    const j = (await res.json()) as { access_token?: string }
    return j.access_token ?? null
  } catch {
    return null
  }
}

// Gate de qualificação — mesmo racional do produto (doc-produto §3):
// corta quem não tem caixa, não tem lead ou está só pesquisando; verde é
// quem tem time 1–8, fatura 20k+, tem leads, CRM não resolvido e urgência.
function classify(a: Record<string, string>): 'verde' | 'amarelo' | 'vermelho' {
  const fat = a.faturamento ?? ''
  const origem = a.origem_leads ?? ''
  const quando = a.quando ?? ''
  const crm = a.usa_crm ?? ''
  const vend = a.vendedores ?? ''

  if (fat.startsWith('Até') || origem.startsWith('Quase') || quando.startsWith('Só')) {
    return 'vermelho'
  }
  const temUrgencia = quando.startsWith('Agora') || quando.startsWith('Nas')
  const crmNaoResolvido = crm !== 'Uso e o time usa'
  const timeNoICP = vend !== '9 ou mais'
  if (temUrgencia && crmNaoResolvido && timeNoICP) return 'verde'
  return 'amarelo'
}

interface LeadgenValue {
  leadgen_id?: string
  page_id?: string
  form_id?: string
  ad_id?: string
  created_time?: number
}

async function processLeadgen(value: LeadgenValue) {
  const leadgenId = value.leadgen_id ? String(value.leadgen_id) : null
  const pageId = value.page_id ? String(value.page_id) : null
  if (!leadgenId || !pageId) return
  const route = PAGE_ROUTES[pageId]
  if (!route) {
    console.warn('[leadgen] página sem rota configurada', pageId)
    return
  }
  const db = admin()

  // idempotência — a Meta reentrega eventos
  const { data: seen } = await db
    .from('meta_leadgen_leads')
    .select('id')
    .eq('leadgen_id', leadgenId)
    .maybeSingle()
  if (seen) return

  // 1. busca o lead completo na Graph
  const pt = await pageToken(pageId)
  if (!pt) {
    console.error('[leadgen] sem page token — lead não importado', leadgenId)
    return
  }
  let lead: {
    field_data?: { name?: string; values?: string[] }[]
    ad_id?: string
    campaign_id?: string
    form_id?: string
    created_time?: string
  }
  try {
    const res = await fetch(
      `${GRAPH}/${leadgenId}?fields=field_data,ad_id,campaign_id,form_id,created_time&access_token=${encodeURIComponent(pt)}`,
    )
    if (!res.ok) {
      console.error('[leadgen] fetch lead falhou', res.status, await res.text())
      return
    }
    lead = await res.json()
  } catch (err) {
    console.error('[leadgen] fetch lead erro', err)
    return
  }

  // 2. field_data → contato + respostas
  const fields: Record<string, string> = {}
  for (const f of lead.field_data ?? []) {
    if (f.name && f.values?.length) fields[f.name] = String(f.values[0])
  }
  const name = fields.full_name ?? 'Lead (Form Meta)'
  const email = fields.email ?? null
  const phoneRaw = fields.phone_number ?? null
  const answers = {
    vendedores: fields.vendedores ?? null,
    usa_crm: fields.usa_crm ?? null,
    faturamento: fields.faturamento ?? null,
    origem_leads: fields.origem_leads ?? null,
    quando: fields.quando ?? null,
  }
  const fit = classify(fields)

  // 3. conta / pipeline / estágio
  const [{ data: acc }, { data: pipeline }] = await Promise.all([
    db
      .from('accounts')
      .select('owner_user_id, default_currency')
      .eq('id', route.accountId)
      .maybeSingle(),
    db
      .from('pipelines')
      .select('id')
      .eq('account_id', route.accountId)
      .eq('name', route.pipeline)
      .maybeSingle(),
  ])
  const ownerId = (acc as { owner_user_id?: string } | null)?.owner_user_id
  const pipelineId = (pipeline as { id?: string } | null)?.id
  if (!ownerId || !pipelineId) {
    console.error('[leadgen] conta/pipeline não encontrado', route)
    return
  }
  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('name', STAGE_BY_FIT[fit])
    .maybeSingle()
  const stageId = (stage as { id?: string } | null)?.id ?? null

  // 4. contato — dedup por phone_normalized (sem telefone, dedup por leadgen)
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null
  let contactId: string | null = null
  if (phone) {
    const { data: existing } = await db
      .from('contacts')
      .select('id, name, email')
      .eq('account_id', route.accountId)
      .eq('phone_normalized', phone)
      .maybeSingle()
    if (existing) {
      contactId = (existing as { id: string }).id
      const patch: Record<string, string> = {}
      if (!(existing as { name?: string }).name && name) patch.name = name
      if (!(existing as { email?: string }).email && email) patch.email = email
      if (Object.keys(patch).length) await db.from('contacts').update(patch).eq('id', contactId)
    }
  }
  if (!contactId) {
    const { data: created, error: cErr } = await db
      .from('contacts')
      .insert({
        account_id: route.accountId,
        user_id: ownerId,
        phone: phoneRaw,
        name,
        email,
      })
      .select('id')
      .single()
    if (cErr || !created) {
      if (phone) {
        const { data: again } = await db
          .from('contacts')
          .select('id')
          .eq('account_id', route.accountId)
          .eq('phone_normalized', phone)
          .maybeSingle()
        contactId = (again as { id: string } | null)?.id ?? null
      }
      if (!contactId) {
        console.error('[leadgen] contato falhou', cErr)
        return
      }
    } else {
      contactId = (created as { id: string }).id
    }
  }

  // 5. deal já no estágio do gate, com as respostas na nota
  const resumo = [
    `Formulário Meta (CCC) · fit ${fit.toUpperCase()}`,
    `Vendedores: ${answers.vendedores ?? '—'}`,
    `CRM: ${answers.usa_crm ?? '—'}`,
    `Faturamento/mês: ${answers.faturamento ?? '—'}`,
    `Origem dos leads: ${answers.origem_leads ?? '—'}`,
    `Quando: ${answers.quando ?? '—'}`,
  ].join('\n')
  const { data: deal } = await db
    .from('deals')
    .insert({
      account_id: route.accountId,
      user_id: ownerId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      contact_id: contactId,
      title: `${name} — Form Meta CCC (${fit})`,
      status: 'open',
      currency: (acc as { default_currency?: string } | null)?.default_currency ?? 'BRL',
      notes: resumo,
    })
    .select('id')
    .single()
  const dealId = (deal as { id?: string } | null)?.id ?? null

  // 6. vínculo leadgen ↔ deal (chave da devolução de conversões)
  await db.from('meta_leadgen_leads').insert({
    leadgen_id: leadgenId,
    account_id: route.accountId,
    contact_id: contactId,
    deal_id: dealId,
    page_id: pageId,
    form_id: lead.form_id ? String(lead.form_id) : value.form_id ? String(value.form_id) : null,
    ad_id: lead.ad_id ? String(lead.ad_id) : value.ad_id ? String(value.ad_id) : null,
    campaign_id: lead.campaign_id ? String(lead.campaign_id) : null,
    fit,
    answers,
    raw: lead.field_data ?? null,
  })

  // 7. atribuição (relatórios) — mesmo destino dos leads do Funil 2
  await db.from('lead_attribution').insert({
    account_id: route.accountId,
    contact_id: contactId,
    deal_id: dealId,
    source: route.origem,
    classificacao: fit,
    raw: { leadgen_id: leadgenId, ...answers },
  })

  // 8. alerta interno pro time (verde/amarelo valem atenção humana)
  if ((fit === 'verde' || fit === 'amarelo') && phone) {
    await notifyTeamNewLead({
      supabase: db,
      accountId: route.accountId,
      nome: name,
      whatsapp: phone,
      status: fit,
      origem: 'Formulário Meta (CCC)',
      faturamento: answers.faturamento,
    }).catch(() => {})
  }
}

// GET — verificação do webhook (hub.challenge)
export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = await appConfig('leadgen_verify_token')
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'verification failed' }, { status: 403 })
}

// POST — eventos leadgen
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[leadgen] assinatura inválida')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: {
    object?: string
    entry?: { changes?: { field?: string; value?: LeadgenValue }[] }[]
  }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.object !== 'page') return NextResponse.json({ ok: true })

  const values: LeadgenValue[] = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'leadgen' && change.value) values.push(change.value)
    }
  }

  // Ack imediato; processa em after() (mesmo padrão do webhook WhatsApp —
  // sem isso a serverless congela e o lead se perde).
  after(async () => {
    for (const v of values) {
      await processLeadgen(v).catch((err) => console.error('[leadgen] process erro', err))
    }
  })
  return NextResponse.json({ ok: true })
}
