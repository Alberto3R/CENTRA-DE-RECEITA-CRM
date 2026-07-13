import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { fireWebLead } from '@/lib/conversions/capi'
import { notifyTeamNewLead } from '@/lib/notifications/lead-alert'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'

// ============================================================
// POST /api/leads — captação de lead da landing (Funil 2) direto no CRM
//
// A landing posta o objeto `answers` aqui (sem Make no meio). Cria/acha
// o contato, abre um deal no pipeline "Tráfego Pago" no estágio certo
// pela classificação, e grava a atribuição (UTMs + ids do Meta) pra
// relatórios. Escreve com service-role (a landing não tem sessão).
//
// Auth: header `x-lead-token` == LEAD_CAPTURE_TOKEN.
// Conta de destino: LEAD_CAPTURE_ACCOUNT_ID.
// ============================================================

// token (x-lead-token) → conta de destino + pipeline. Retrocompatível:
// o token existente continua indo pra Sales 3R · "Tráfego Pago" (Sprint);
// o token AUGRA vai pra conta AUGRA · "AUGRA · Recrutamento" (esta campanha).
// Cada token é um segredo separado — dá pra revogar/rotacionar um sem mexer no outro.
function resolveRoute(
  token: string | null,
): { accountId: string; pipeline: string; welcomeTemplate?: string } | null {
  if (!token) return null
  const routes: Record<
    string,
    { accountId?: string; pipeline: string; welcomeTemplate?: string }
  > = {}
  if (process.env.LEAD_CAPTURE_TOKEN)
    routes[process.env.LEAD_CAPTURE_TOKEN] = {
      accountId: process.env.LEAD_CAPTURE_ACCOUNT_ID,
      pipeline: 'Tráfego Pago',
    }
  if (process.env.LEAD_CAPTURE_TOKEN_AUGRA)
    routes[process.env.LEAD_CAPTURE_TOKEN_AUGRA] = {
      accountId: process.env.LEAD_CAPTURE_ACCOUNT_ID_AUGRA,
      pipeline: 'AUGRA · Recrutamento',
      welcomeTemplate: 'augra_calculadora_abertura',
    }
  const r = routes[token]
  return r && r.accountId
    ? { accountId: r.accountId, pipeline: r.pipeline, welcomeTemplate: r.welcomeTemplate }
    : null
}

// classificação do gate → estágio do pipeline
const STAGE_BY_STATUS: Record<string, string> = {
  verde: 'Qualificado (verde)',
  amarelo: 'Em avaliação (amarelo)',
  vermelho: 'Off-gate / Perdido',
}
const DEFAULT_STAGE = 'Novo lead'

// `any` para o client service-role — mesmo padrão do webhook/config:
// sem o tipo Database gerado, o supabase-js infere `never` nos inserts.
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
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// R$ a partir de número (ou string numérica). Ex.: 210000 → "R$ 210.000".
function brl(v: unknown): string | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? Number(v.replace(/[^\d.-]/g, ''))
        : NaN
  return Number.isFinite(n) ? 'R$ ' + Math.round(n).toLocaleString('pt-BR') : null
}

// Nomes dos campos customizados (batem com os criados na conta AUGRA).
const CF_CARGO = 'Cargo da vaga'
const CF_SALARIO = 'Salário anunciado'
const CF_DIAS = 'Dias em aberto'
const CF_QTD = 'Nº de vagas'
const CF_PERDA = 'Perda estimada/mês'

// Enriquecimento do contato com os dados da calculadora: grava os campos
// customizados + uma nota-resumo (pro humano ver no timeline e o agente usar).
// Self-scoped: só age quando o lead traz `cargo_vaga` (calculadora) e a conta
// tem os campos — leads do Sprint (sem cargo_vaga) passam batido.
async function enrichLeadFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  accountId: string,
  contactId: string,
  ownerId: string,
  a: Record<string, unknown>,
) {
  const cargo = str(a.cargo_vaga)
  if (!cargo) return

  const salario = brl(a.salario_anunciado)
  const dias = a.dias_vaga_aberta != null ? String(a.dias_vaga_aberta) : null
  const qtd = a.qtd_vagas_abertas != null ? String(a.qtd_vagas_abertas) : null
  const perdaMes = brl(a.custo_estimado_mensal)
  const perdaTotal = brl(a.custo_estimado_total)

  // 1) valores nos campos customizados da conta
  const wanted: Record<string, string | null> = {
    [CF_CARGO]: cargo,
    [CF_SALARIO]: salario,
    [CF_DIAS]: dias,
    [CF_QTD]: qtd,
    [CF_PERDA]: perdaMes,
  }
  const { data: fields } = await db
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', accountId)
    .in('field_name', Object.keys(wanted))
  const rows = ((fields as { id: string; field_name: string }[]) ?? [])
    .filter((f) => wanted[f.field_name] != null)
    .map((f) => ({ contact_id: contactId, custom_field_id: f.id, value: wanted[f.field_name] }))
  if (rows.length) {
    await db.from('contact_custom_values').upsert(rows, { onConflict: 'contact_id,custom_field_id' })
  }

  // 2) nota-resumo (aparece no timeline do contato)
  const note =
    `📊 Calculadora de Vaga Aberta — vaga de ${cargo}` +
    (qtd ? ` (×${qtd})` : '') +
    (dias ? `, aberta há ${dias} dias` : '') +
    (salario ? ` · salário anunciado ${salario}` : '') +
    (perdaMes ? ` · perda estimada ${perdaMes}/mês` : '') +
    (perdaTotal ? ` (acumulada ${perdaTotal})` : '') +
    '. Estimativa de mercado. Origem: tráfego pago.'
  await db
    .from('contact_notes')
    .insert({ account_id: accountId, contact_id: contactId, user_id: ownerId, note_text: note })
}

// Mensagem de abertura (template aprovado) logo após o cadastro do lead.
// AUTO-GATED: só dispara quando o template está APPROVED na Meta — antes disso
// (DRAFT/PENDING) não faz nada, evitando chamada que a Meta rejeitaria. No
// minuto em que a Meta aprova (webhook atualiza status → APPROVED), começa
// a disparar sozinho, sem redeploy.
async function maybeSendWelcome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  accountId: string,
  templateName: string | undefined,
  toPhone: string,
  name: string,
) {
  if (!templateName) return

  const { data: tpl } = await db
    .from('message_templates')
    .select('status, language')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .maybeSingle()
  if (!tpl || tpl.status !== 'APPROVED') return

  const wa = await resolveChannelConfig(db, accountId)
  if (!wa?.phone_number_id || !wa?.access_token) return

  let token: string
  try {
    token = decrypt(wa.access_token as string)
  } catch {
    return
  }

  const firstName = (name || '').trim().split(/\s+/)[0] || 'tudo bem'
  await sendTemplateMessage({
    phoneNumberId: wa.phone_number_id as string,
    accessToken: token,
    to: toPhone,
    templateName,
    language: (tpl.language as string) || 'pt_BR',
    params: [firstName],
  })
}

export async function POST(request: Request) {
  // 1. Auth + roteamento por token (conta + pipeline de destino)
  const route = resolveRoute(request.headers.get('x-lead-token'))
  if (!route) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const accountId = route.accountId
  const pipelineName = route.pipeline

  // 2. Payload
  let a: Record<string, unknown>
  try {
    a = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const name = str(a.nome) ?? str(a.name) ?? 'Lead (Funil 2)'
  const phoneRaw = str(a.phone_e164) ?? str(a.whatsapp) ?? str(a.telefone)
  if (!phoneRaw) {
    return NextResponse.json({ error: 'missing phone' }, { status: 400 })
  }
  const phone = normalizePhone(phoneRaw)
  const status = (str(a.status) ?? '').toLowerCase()
  const db = admin()

  // 3. Owner da conta (user_id NOT NULL nos inserts) + pipeline + estágio
  const [{ data: acc }, { data: pipeline }] = await Promise.all([
    db.from('accounts').select('owner_user_id, default_currency').eq('id', accountId).maybeSingle(),
    db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', pipelineName)
      .maybeSingle(),
  ])
  const ownerId = (acc as { owner_user_id?: string } | null)?.owner_user_id
  const pipelineId = (pipeline as { id?: string } | null)?.id
  if (!ownerId || !pipelineId) {
    return NextResponse.json({ error: 'account/pipeline not found' }, { status: 500 })
  }
  const stageName = STAGE_BY_STATUS[status] ?? DEFAULT_STAGE
  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('name', stageName)
    .maybeSingle()
  const stageId = (stage as { id?: string } | null)?.id ?? null

  // 4. Contato — dedup por phone_normalized (mesma chave do webhook)
  let contactId: string
  const { data: existing } = await db
    .from('contacts')
    .select('id, name, email')
    .eq('account_id', accountId)
    .eq('phone_normalized', phone)
    .maybeSingle()
  if (existing) {
    contactId = (existing as { id: string }).id
    // completa nome/e-mail se estavam vazios
    const patch: Record<string, string> = {}
    if (!(existing as { name?: string }).name && name) patch.name = name
    if (!(existing as { email?: string }).email && str(a.email)) patch.email = str(a.email)!
    if (Object.keys(patch).length) await db.from('contacts').update(patch).eq('id', contactId)
  } else {
    const { data: created, error: cErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerId,
        phone: phoneRaw,
        // phone_normalized é coluna GERADA (regexp_replace(phone,'\D','')) —
        // o Postgres calcula sozinho; inserir valor nela dá erro.
        name,
        email: str(a.email),
        company: str(a.empresa) ?? str(a.segmento),
      })
      .select('id')
      .single()
    if (cErr || !created) {
      // corrida de dedup: re-busca
      const { data: again } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .eq('phone_normalized', phone)
        .maybeSingle()
      if (!again) {
        return NextResponse.json({ error: 'contact insert failed' }, { status: 500 })
      }
      contactId = (again as { id: string }).id
    } else {
      contactId = (created as { id: string }).id
    }
  }

  // 5. Deal no pipeline Tráfego Pago
  const { data: deal } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: ownerId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      contact_id: contactId,
      title: `${name} — Tráfego pago${status ? ` (${status})` : ''}`,
      status: 'open',
      currency: (acc as { default_currency?: string } | null)?.default_currency ?? 'BRL',
      notes: str(a.segmento) || str(a.faturamento) ? `Segmento: ${str(a.segmento) ?? '—'} · Faturamento: ${str(a.faturamento) ?? '—'}` : null,
    })
    .select('id')
    .single()
  const dealId = (deal as { id?: string } | null)?.id ?? null

  // 6. Atribuição (UTMs + ids do Meta + payload bruto)
  await db.from('lead_attribution').insert({
    account_id: accountId,
    contact_id: contactId,
    deal_id: dealId,
    source: str(a.origem) ?? 'funil2-landing',
    utm_source: str(a.utm_source),
    utm_medium: str(a.utm_medium),
    utm_campaign: str(a.utm_campaign),
    utm_content: str(a.utm_content),
    utm_term: str(a.utm_term),
    ang: str(a.angulo) ?? str(a.ang),
    fbclid: str(a.fbclid),
    fbp: str(a.fbp),
    fbc: str(a.fbc),
    event_id: str(a.event_id),
    classificacao: status || null,
    landing_url: str(a.event_source_url),
    raw: a,
  })

  // 6b. Enriquecimento: campos customizados + nota-resumo com os dados da
  //     calculadora (pro humano ver e o agente IA usar). Nunca derruba a resposta.
  await enrichLeadFields(db, accountId, contactId, ownerId, a).catch(() => {})

  // 6c. Mensagem de abertura no WhatsApp logo após o cadastro (template
  //     aprovado). Auto-gated pelo status do template; nunca derruba a resposta.
  await maybeSendWelcome(db, accountId, route.welcomeTemplate, phone, name).catch(() => {})

  // 7. CAPI "Lead" server-side (dedup com o pixel do navegador via event_id).
  //    Substitui o disparo que o cenário do Make fazia no Funil 2. Await pra
  //    garantir o envio antes da função serverless congelar; nunca derruba a
  //    resposta (fireWebLead trata os próprios erros).
  const capi = await fireWebLead({
    supabase: db,
    accountId,
    eventId: str(a.event_id),
    eventSourceUrl: str(a.event_source_url),
    fbc: str(a.fbc),
    fbp: str(a.fbp),
    fbclid: str(a.fbclid),
    phone,
    email: str(a.email),
  }).catch(() => ({ ok: false, reason: 'threw' }))

  // 8. Alerta interno pro time (substitui o "ping" do Make) — só pra leads
  //    que valem atenção humana: verde (qualificado) e amarelo (avaliação).
  //    Off-gate/vermelho não dispara. Await pra não morrer no serverless.
  let alerted = false
  if (status === 'verde' || status === 'amarelo') {
    const alert = await notifyTeamNewLead({
      supabase: db,
      accountId,
      nome: name,
      whatsapp: phoneRaw,
      status,
      origem: str(a.origem),
      faturamento: str(a.faturamento),
      awareness: str(a.awareness) ?? str(a.consciencia),
      angulo: str(a.angulo) ?? str(a.ang),
    }).catch(() => ({ ok: false, reason: 'threw' }))
    alerted = alert.ok
  }

  return NextResponse.json(
    { data: { contact_id: contactId, deal_id: dealId, capi: capi.ok, alerted } },
    { status: 200 },
  )
}
