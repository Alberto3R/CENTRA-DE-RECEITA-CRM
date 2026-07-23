// Núcleo de importação de leads do formulário nativo da Meta (Lead Ads).
// Usado por DOIS caminhos:
//   1. Webhook /api/meta/leadgen (tempo real, evento `leadgen`)
//   2. Backfill /api/meta/leadgen/backfill (pg_cron 10min — rede de segurança
//      contra falha de entrega/leitura; foi o que recuperou os leads perdidos
//      quando o Leads Access da página bloqueava o system user)
//
// Idempotente por leadgen_id (unique em meta_leadgen_leads).

import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import { notifyTeamNewLead } from '@/lib/notifications/lead-alert'

const GRAPH = 'https://graph.facebook.com/v21.0'

// WABA cujo token (system user Sales 3R) lê páginas/leads.
const TOKEN_WABA = '824812527258696'

// página → destino no CRM. (Campanha CCC: página Alberto Oliveira.)
export const PAGE_ROUTES: Record<
  string,
  { accountId: string; pipeline: string; origem: string }
> = {
  '152902442083026': {
    accountId: 'fd9b374f-e140-4bd4-8200-f8663fb09705', // conta Sales 3R
    pipeline: 'Tráfego Pago',
    origem: 'meta-leadform-ccc',
  },
}

const STAGE_BY_FIT: Record<string, string> = {
  verde: 'Qualificado (verde)',
  amarelo: 'Em avaliação (amarelo)',
  vermelho: 'Off-gate / Perdido',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// token do system user (cifrado no canal) → page access token
export async function pageToken(db: Db, pageId: string): Promise<string | null> {
  const { data } = await db
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

// Gate de qualificação — mesmo racional do doc-produto §3.
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

export interface MetaLead {
  id: string
  field_data?: { name?: string; values?: string[] }[]
  ad_id?: string
  campaign_id?: string
  form_id?: string
  created_time?: string
}

// A Meta devolve respostas de múltipla escolha como a CHAVE da opção
// ("faturamento_3"), não o texto. Buscamos as perguntas do formulário 1×
// e montamos o mapa chave→texto (cache por form_id no processo).
const formLabelCache = new Map<string, Record<string, string>>()

async function formOptionLabels(
  db: Db,
  pageId: string,
  formId: string,
): Promise<Record<string, string>> {
  const cached = formLabelCache.get(formId)
  if (cached) return cached
  const map: Record<string, string> = {}
  try {
    const pt = await pageToken(db, pageId)
    if (pt) {
      const res = await fetch(
        `${GRAPH}/${formId}?fields=questions&access_token=${encodeURIComponent(pt)}`,
      )
      if (res.ok) {
        const j = (await res.json()) as {
          questions?: { key?: string; options?: { key?: string; value?: string }[] }[]
        }
        for (const q of j.questions ?? []) {
          for (const o of q.options ?? []) {
            if (o.key && o.value) map[o.key] = o.value
          }
        }
      }
    }
  } catch {
    // sem mapa, seguimos com os valores crus (melhor importar do que perder)
  }
  formLabelCache.set(formId, map)
  return map
}

/**
 * Importa UM lead já buscado da Graph: contato (dedup por telefone) +
 * deal no estágio do gate + vínculo meta_leadgen_leads + atribuição +
 * alerta pro time. Retorna o outcome (string) para log/telemetria.
 */
export async function importLead(db: Db, pageId: string, lead: MetaLead): Promise<string> {
  const route = PAGE_ROUTES[pageId]
  if (!route) return 'skipped_page_sem_rota'

  // idempotência
  const { data: seen } = await db
    .from('meta_leadgen_leads')
    .select('id')
    .eq('leadgen_id', lead.id)
    .maybeSingle()
  if (seen) return 'already_imported'

  const fields: Record<string, string> = {}
  for (const f of lead.field_data ?? []) {
    if (f.name && f.values?.length) fields[f.name] = String(f.values[0])
  }
  // decodifica chaves de opção → texto (ex.: "faturamento_3" → "Mais de R$200 mil")
  if (lead.form_id) {
    const labels = await formOptionLabels(db, pageId, String(lead.form_id))
    for (const k of Object.keys(fields)) {
      const label = labels[fields[k]]
      if (label) fields[k] = label
    }
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
  if (!ownerId || !pipelineId) return 'error_conta_pipeline'

  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('name', STAGE_BY_FIT[fit])
    .maybeSingle()
  const stageId = (stage as { id?: string } | null)?.id ?? null

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
      if (!contactId) return 'error_contato'
    } else {
      contactId = (created as { id: string }).id
    }
  }

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

  await db.from('meta_leadgen_leads').insert({
    leadgen_id: lead.id,
    account_id: route.accountId,
    contact_id: contactId,
    deal_id: dealId,
    page_id: pageId,
    form_id: lead.form_id ? String(lead.form_id) : null,
    ad_id: lead.ad_id ? String(lead.ad_id) : null,
    campaign_id: lead.campaign_id ? String(lead.campaign_id) : null,
    fit,
    answers,
    raw: lead.field_data ?? null,
  })

  await db.from('lead_attribution').insert({
    account_id: route.accountId,
    contact_id: contactId,
    deal_id: dealId,
    source: route.origem,
    classificacao: fit,
    raw: { leadgen_id: lead.id, ...answers },
  })

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
  return `imported_${fit}`
}

export interface LeadgenValue {
  leadgen_id?: string
  page_id?: string
  form_id?: string
  ad_id?: string
  created_time?: number
}

/** Caminho do webhook: busca o lead na Graph pelo id e importa. */
export async function processLeadgenEvent(db: Db, value: LeadgenValue): Promise<string> {
  const leadgenId = value.leadgen_id ? String(value.leadgen_id) : null
  const pageId = value.page_id ? String(value.page_id) : null
  if (!leadgenId || !pageId) return 'skipped_payload'
  if (!PAGE_ROUTES[pageId]) {
    console.warn('[leadgen] página sem rota configurada', pageId)
    return 'skipped_page_sem_rota'
  }

  const pt = await pageToken(db, pageId)
  if (!pt) return 'error_page_token'

  try {
    const res = await fetch(
      `${GRAPH}/${leadgenId}?fields=field_data,ad_id,campaign_id,form_id,created_time&access_token=${encodeURIComponent(pt)}`,
    )
    if (!res.ok) {
      // Leitura pode falhar por Leads Access da página — o backfill (cron)
      // recupera assim que o acesso for concedido.
      console.error('[leadgen] fetch lead falhou', res.status, await res.text())
      return 'error_fetch'
    }
    const lead = (await res.json()) as Omit<MetaLead, 'id'>
    return importLead(db, pageId, {
      id: leadgenId,
      ...lead,
      form_id: lead.form_id ?? (value.form_id ? String(value.form_id) : undefined),
      ad_id: lead.ad_id ?? (value.ad_id ? String(value.ad_id) : undefined),
    })
  } catch (err) {
    console.error('[leadgen] fetch lead erro', err)
    return 'error_fetch'
  }
}

/**
 * Backfill: varre os formulários das páginas configuradas e importa
 * qualquer lead que ainda não esteja no CRM. Rede de segurança contra
 * falha de webhook/leitura. Retorna resumo por página.
 */
export async function backfillFromForms(db: Db): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = {}
  for (const pageId of Object.keys(PAGE_ROUTES)) {
    const pt = await pageToken(db, pageId)
    if (!pt) {
      summary[pageId] = 'error_page_token'
      continue
    }
    const formsRes = await fetch(
      `${GRAPH}/${pageId}/leadgen_forms?fields=id,leads_count&limit=25&access_token=${encodeURIComponent(pt)}`,
    )
    if (!formsRes.ok) {
      summary[pageId] = `error_forms_${formsRes.status}`
      continue
    }
    const forms = ((await formsRes.json()).data ?? []) as { id: string; leads_count?: number }[]
    const outcomes: Record<string, number> = {}
    for (const form of forms) {
      if (!form.leads_count) continue
      const leadsRes = await fetch(
        `${GRAPH}/${form.id}/leads?fields=id,created_time,ad_id,campaign_id,field_data&limit=100&access_token=${encodeURIComponent(pt)}`,
      )
      if (!leadsRes.ok) {
        outcomes[`form_${form.id}_error`] = leadsRes.status
        continue
      }
      const leads = ((await leadsRes.json()).data ?? []) as MetaLead[]
      if (!leads.length) continue
      // pula os que já entraram (1 query pro lote)
      const { data: existing } = await db
        .from('meta_leadgen_leads')
        .select('leadgen_id')
        .in('leadgen_id', leads.map((l) => l.id))
      const seen = new Set(
        ((existing ?? []) as { leadgen_id: string }[]).map((e) => e.leadgen_id),
      )
      for (const lead of leads) {
        if (seen.has(lead.id)) {
          outcomes.already_imported = (outcomes.already_imported ?? 0) + 1
          continue
        }
        const out = await importLead(db, pageId, { ...lead, form_id: form.id })
        outcomes[out] = (outcomes[out] ?? 0) + 1
      }
    }
    summary[pageId] = outcomes
  }
  return summary
}
