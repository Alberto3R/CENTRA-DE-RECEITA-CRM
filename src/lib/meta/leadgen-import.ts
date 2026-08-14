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
import { resolveChannelConfig } from '@/lib/whatsapp/channel'

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

// Rota por CAMPANHA — precisa vir antes da rota por página, porque a mesma
// página (Alberto Oliveira) serve mais de uma campanha com formulários
// diferentes. Sem isso, o lead do VSC caía no gate do CCC, que lê perguntas
// que o formulário do VSC não tem, e ia parar num estágio que a cadência de
// WhatsApp não varre — ou seja, ninguém falava com ele.
const CAMPAIGN_ROUTES: Record<
  string,
  { pipeline: string; stage: string; origem: string; gate: 'ccc' | 'vsc' }
> = {
  // VSC · Formulário Nativo | Leads (ABO)
  '120249257494000447': {
    pipeline: 'Tráfego Pago',
    // "Prospecção" é o único estágio que a diag-cadencia varre. Todo lead
    // entra aqui, inclusive fora do ICP: o fit fica registrado nas notas,
    // mas ninguém é enterrado num estágio silencioso.
    stage: 'Prospecção',
    origem: 'meta-leadform-vsc',
    gate: 'vsc',
  },
}

// O formulário do VSC foi montado pela interface, então a Meta gerou os
// nomes dos campos sozinha (algo como "quantos_vendedores_voce_tem_hoje").
// Casar por pedaço do nome em vez de nome exato evita depender desse slug.
function acha(fields: Record<string, string>, ...termos: string[]): string {
  for (const [k, v] of Object.entries(fields)) {
    const chave = k.toLowerCase()
    if (termos.some((t) => chave.includes(t))) return v
  }
  return ''
}

// Gate do VSC: o ICP é dono com time e volume. Sem time e sem faturamento,
// é autônomo — entra, mas marcado.
function classifyVSC(fields: Record<string, string>): 'verde' | 'amarelo' | 'vermelho' {
  const vend = acha(fields, 'vendedor')
  const fat = acha(fields, 'faturamento')
  const oport = acha(fields, 'oportunidade')
  const semTime = vend.startsWith('Só eu')
  const fatBaixo = fat.startsWith('Até')
  if (semTime && fatBaixo) return 'vermelho'
  const timeReal = vend.startsWith('2 a 4') || vend.startsWith('5 ou mais')
  const fatReal = !fatBaixo && fat !== ''
  const volume = !oport.startsWith('Até 50') && oport !== ''
  if (timeReal && fatReal && volume) return 'verde'
  return 'amarelo'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// Abertura imediata do lead de formulário nativo.
//
// A `diag-cadencia` só roda de hora em hora e ainda espera 2h antes do
// primeiro toque — carência que existe para não atropelar a abertura que o
// intake do quiz já enfileira. Lead de formulário nativo não tem intake, então
// essa espera era só atraso: até 3h para falar com quem acabou de levantar a
// mão em um anúncio pago.
//
// Aqui a abertura é enfileirada no ato do cadastro; o `broadcast-drain`
// (pg_cron, 1 min) envia. O nome do broadcast segue o padrão que a cadência lê
// (`Diag abertura · nome · contact_id`), então ela conta este envio como toque
// 1 e continua do toque 2 — sem mensagem repetida.
const TPL_ABERTURA_LEADGEN = 'diag_toque3_consultoria'

async function enfileiraAbertura(
  db: Db,
  accountId: string,
  ownerId: string,
  contactId: string,
  nomeCompleto: string,
): Promise<string> {
  const canal = await resolveChannelConfig(db, accountId)
  if (!canal?.id) return 'sem_canal'

  const { data: tpl } = await db
    .from('message_templates')
    .select('status')
    .eq('channel_id', canal.id)
    .eq('language', 'pt_BR')
    .eq('name', TPL_ABERTURA_LEADGEN)
    .maybeSingle()
  if ((tpl as { status?: string } | null)?.status !== 'APPROVED') return 'template_nao_aprovado'

  const nome = String(nomeCompleto || '').split(/\s+/)[0] || 'tudo bem'
  const { data: bc, error } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      user_id: ownerId,
      channel_id: canal.id,
      name: `Diag abertura · ${nome} · ${contactId}`,
      template_name: TPL_ABERTURA_LEADGEN,
      template_language: 'pt_BR',
      template_variables: { '1': { type: 'static', value: nome } },
      status: 'draft',
      total_recipients: 1,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    })
    .select('id')
    .single()
  if (error || !bc) return 'erro_broadcast'

  await db.from('broadcast_recipients').insert({
    broadcast_id: (bc as { id: string }).id,
    contact_id: contactId,
    status: 'pending',
  })
  // scheduled_at no passado = o drain pega na próxima passada (até 1 min)
  await db
    .from('broadcasts')
    .update({ status: 'scheduled', scheduled_at: new Date(Date.now() - 60000).toISOString() })
    .eq('id', (bc as { id: string }).id)
  return 'abertura_enfileirada'
}

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
  // campanha manda; página é o fallback (comportamento antigo, CCC)
  const campanha = lead.campaign_id ? CAMPAIGN_ROUTES[String(lead.campaign_id)] : undefined
  const gate = campanha?.gate ?? 'ccc'
  const origem = campanha?.origem ?? route.origem
  const pipelineNome = campanha?.pipeline ?? route.pipeline

  const answers =
    gate === 'vsc'
      ? {
          vendedores: acha(fields, 'vendedor') || null,
          faturamento: acha(fields, 'faturamento') || null,
          oportunidades: acha(fields, 'oportunidade') || null,
          usa_crm: null,
          origem_leads: null,
          quando: null,
        }
      : {
          vendedores: fields.vendedores ?? null,
          usa_crm: fields.usa_crm ?? null,
          faturamento: fields.faturamento ?? null,
          origem_leads: fields.origem_leads ?? null,
          quando: fields.quando ?? null,
          oportunidades: null,
        }
  const fit = gate === 'vsc' ? classifyVSC(fields) : classify(fields)

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
      .eq('name', pipelineNome)
      .maybeSingle(),
  ])
  const ownerId = (acc as { owner_user_id?: string } | null)?.owner_user_id
  const pipelineId = (pipeline as { id?: string } | null)?.id
  if (!ownerId || !pipelineId) return 'error_conta_pipeline'

  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('name', campanha?.stage ?? STAGE_BY_FIT[fit])
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

  const rotulo = gate === 'vsc' ? 'VSC' : 'CCC'
  const resumo = (
    gate === 'vsc'
      ? [
          `Formulário Meta (VSC) · fit ${fit.toUpperCase()}`,
          `Vendedores: ${answers.vendedores ?? '—'}`,
          `Faturamento/mês: ${answers.faturamento ?? '—'}`,
          `Oportunidades/mês: ${answers.oportunidades ?? '—'}`,
        ]
      : [
          `Formulário Meta (CCC) · fit ${fit.toUpperCase()}`,
          `Vendedores: ${answers.vendedores ?? '—'}`,
          `CRM: ${answers.usa_crm ?? '—'}`,
          `Faturamento/mês: ${answers.faturamento ?? '—'}`,
          `Origem dos leads: ${answers.origem_leads ?? '—'}`,
          `Quando: ${answers.quando ?? '—'}`,
        ]
  ).join('\n')
  const { data: deal } = await db
    .from('deals')
    .insert({
      account_id: route.accountId,
      user_id: ownerId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      contact_id: contactId,
      title: `${name} — Form Meta ${rotulo} (${fit})`,
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

  // Abertura no ato, só para o funil de formulário nativo. O CCC segue como
  // estava (quem fala com ele é a esteira própria dele).
  if (gate === 'vsc' && phone && contactId && ownerId) {
    await enfileiraAbertura(db, route.accountId, ownerId, contactId, name).catch(() => {})
  }

  // Alerta para TODO lead novo, inclusive vermelho. Antes só verde/amarelo
  // avisavam, e o lead fora do gate entrava mudo — a gente só descobria
  // abrindo o CRM. Se pagamos pelo lead, ele merece pelo menos um aviso.
  if (phone) {
    await notifyTeamNewLead({
      supabase: db,
      accountId: route.accountId,
      nome: name,
      whatsapp: phone,
      status: fit,
      origem: `Formulário Meta (${rotulo})`,
      faturamento: answers.faturamento,
      resumo:
        gate === 'vsc'
          ? `Vendedores: ${answers.vendedores ?? '—'} • faturamento/mês: ${answers.faturamento ?? '—'} • oportunidades/mês: ${answers.oportunidades ?? '—'}`
          : null,
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
