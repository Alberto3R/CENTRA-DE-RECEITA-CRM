import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'

// ============================================================
// POST /api/webhooks/gateway/[token] — webhook de gateway (Voomp etc.)
//
// O token na URL identifica a config (conta + funil + mapeamento de
// trigger→etapa). Cria/acha o contato, aplica a tag do produto e abre o
// negócio na etapa do evento. Idempotente por (config, pedido, trigger).
// Sempre responde 200 pra o gateway não re-tentar em loop.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isUnique(e: any) {
  return e?.code === '23505' || /duplicate key|unique/i.test(e?.message || '')
}
function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  return null
}

// Normaliza texto pra comparação (sem acento, minúsculo, só alfanum).
function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Auto-roteamento: acha o funil cujo NOME casa com o produto. Prioriza
// igualdade > funil contido no produto ("Otológicas" ⊆ "Formulações
// Otológicas") > produto contido no funil. Empate real (ex.: produto
// genérico "Masterclass" com 2 funis Masterclass) → null (não chuta).
function pickPipelineByProduct(
  pipes: { id: string; name: string }[],
  productName: string,
): { id: string; name: string } | null {
  const p = norm(productName)
  if (!p) return null
  const scored = pipes
    .map((pl) => {
      const n = norm(pl.name)
      if (!n) return null
      if (n === p) return { id: pl.id, name: pl.name, score: 3, len: n.length }
      if (p.includes(n)) return { id: pl.id, name: pl.name, score: 2, len: n.length }
      if (n.includes(p)) return { id: pl.id, name: pl.name, score: 1, len: n.length }
      return null
    })
    .filter(Boolean) as { id: string; name: string; score: number; len: number }[]
  if (!scored.length) return null
  scored.sort((a, b) => b.score - a.score || b.len - a.len)
  const top = scored[0]
  if (scored.filter((s) => s.score === top.score && s.len === top.len).length > 1) return null
  return top
}

// Resolve etapa por evento a partir da SEMÂNTICA dos nomes das etapas do
// funil (venda/ganho/fechado, carrinho abandonado, pix/boleto, refund).
function autoStageMap(
  stages: { id: string; name: string; position: number }[],
): Record<string, string> {
  const find = (re: RegExp) => stages.find((s) => re.test(norm(s.name)))
  const notLost = stages.filter((s) => !/perdid|perda|lost|cancel|reembols/.test(norm(s.name)))
  const won = find(/ganho|ganha|venda|fechad|pago|won/) ?? notLost[notLost.length - 1]
  const abandoned = find(/abandon|carrinho/) ?? stages[0]
  const pending = find(/pix|boleto|pend|aguard|gerad/) ?? null
  const m: Record<string, string> = {}
  const set = (keys: string[], sid?: string | null) => {
    if (sid) for (const k of keys) m[k] = sid
  }
  set(['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'salePaid', 'saleApproved', 'paid'], won?.id)
  set(
    ['PURCHASE_OUT_OF_SHOPPING_CART', 'checkoutAbandoned', 'abandonedCart', 'abandonedCheckout', 'saleAbandonedCart'],
    abandoned?.id,
  )
  set(['PURCHASE_BILLET_PRINTED', 'PURCHASE_DELAYED', 'waiting_payment', 'pixGenerated', 'pixCreated'], pending?.id)
  for (const k of ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_PROTEST', 'saleRefunded', 'saleChargeback', 'refunded', 'chargedback'])
    m[k] = 'refund'
  return m
}

// Telefone do comprador na Hotmart — o formato varia por versão:
//   buyer.checkout_phone: "5511999999999"
//   buyer.phone: "..." (string) | { ddd, number } | { country_code, area_code, number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hotmartPhone(buyer: any): string | null {
  if (str(buyer?.checkout_phone)) return str(buyer.checkout_phone)
  const p = buyer?.phone
  if (typeof p === 'string') return str(p)
  if (p && typeof p === 'object') {
    const parts = [p.country_code, p.area_code ?? p.ddd, p.number].map((x) => str(x)).filter(Boolean)
    if (parts.length) return parts.join('')
  }
  return null
}
const ack = (reason: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, reason, ...extra }, { status: 200 })

const DEFAULT_TAG_COLOR = '#A6E43C'
const GRAPH = 'https://graph.facebook.com/v22.0'

// find-or-create de tag (por nome, na conta) + vínculo no contato
async function tagContact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  accountId: string,
  ownerId: string,
  contactId: string,
  tagName: string | null,
) {
  if (!tagName) return
  let tagId: string | null = null
  const { data: existing } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', tagName)
    .maybeSingle()
  if (existing) {
    tagId = existing.id
  } else {
    const { data: created, error } = await db
      .from('tags')
      .insert({ account_id: accountId, user_id: ownerId, name: tagName, color: DEFAULT_TAG_COLOR })
      .select('id')
      .single()
    if (error) {
      if (isUnique(error)) {
        const { data: again } = await db
          .from('tags').select('id').eq('account_id', accountId).ilike('name', tagName).maybeSingle()
        tagId = again?.id ?? null
      } else {
        console.error('[gateway] tag falhou', error.message)
        return
      }
    } else {
      tagId = created.id
    }
  }
  if (!tagId) return
  // vínculo (ignora se já existir)
  await db.from('contact_tags').insert({ contact_id: contactId, tag_id: tagId })
}

// Dispara o template aprovado de recuperação (ex.: eqv_pix_pendente) pro
// lead com PIX pendente. Convenção do template: corpo {{1}} = primeiro nome;
// botão URL {{1}} = id do produto (link de finalizar o pagamento). O agente
// da conta assume quando a pessoa responde.
async function sendRecoveryTemplate(p: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  accountId: string
  phoneRaw: string
  name: string
  productId: string | null
  templateName: string
}): Promise<{ ok: boolean; reason?: string }> {
  const to = p.phoneRaw.replace(/\D/g, '')
  if (!to) return { ok: false, reason: 'no_phone' }
  const wa = await resolveChannelConfig(p.db, p.accountId)
  if (!wa?.phone_number_id || !wa.access_token) return { ok: false, reason: 'whatsapp_not_configured' }
  let token: string
  try {
    token = decrypt(wa.access_token)
  } catch {
    return { ok: false, reason: 'token_decrypt_failed' }
  }
  const firstName = (p.name || 'tudo bem').trim().split(/\s+/)[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any[] = [{ type: 'body', parameters: [{ type: 'text', text: firstName }] }]
  if (p.productId) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: p.productId }],
    })
  }
  try {
    const res = await fetch(`${GRAPH}/${wa.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: p.templateName, language: { code: 'pt_BR' }, components },
      }),
    })
    if (!res.ok) {
      console.error('[recovery] erro Meta', res.status, await res.text())
      return { ok: false, reason: `meta_${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    console.error('[recovery] fetch falhou', e)
    return { ok: false, reason: 'fetch_failed' }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const db = admin()

  const { data: cfg } = await db
    .from('gateway_webhook_config')
    .select('*')
    .eq('token', token)
    .eq('enabled', true)
    .maybeSingle()
  if (!cfg) return ack('config_not_found')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await request.json()
  } catch {
    return ack('bad_json')
  }

  // Normaliza o payload pro modelo interno { sale, product, client }.
  // Dois provedores com formatos diferentes:
  //   Voomp   → { sale, product, client, trigger/currentStatus/event }
  //   Hotmart → { event, data: { buyer, purchase, product } }  (webhook 2.0)
  // Detecta Hotmart pela presença de `data.buyer`/`data.purchase` + `event`.
  const isHotmart =
    !!body?.data &&
    typeof body?.event === 'string' &&
    (!!body.data.buyer || !!body.data.purchase)

  let sale: Record<string, unknown>
  let product: Record<string, unknown>
  let client: Record<string, unknown>
  let orderId: string
  let currentStatus: string | null
  let candidates: string[]

  if (isHotmart) {
    const d = (body.data ?? {}) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const buyer = (d.buyer ?? {}) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const purchase = (d.purchase ?? {}) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const prod = (d.product ?? {}) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    client = { name: buyer.name, email: buyer.email, cellphone: hotmartPhone(buyer) }
    product = { id: prod.id != null ? String(prod.id) : str(prod.ucode), name: prod.name }
    const priceVal =
      purchase?.price?.value ?? purchase?.full_price?.value ?? purchase?.original_offer_price?.value
    sale = {
      id: str(purchase.transaction) ?? str(body.id),
      amount: typeof priceVal === 'number' ? priceVal : Number(priceVal) || 0,
      status: str(purchase.status),
      method: str(purchase?.payment?.type),
    }
    currentStatus = str(purchase.status) // APPROVED, COMPLETE, WAITING_PAYMENT, ...
    orderId = str(purchase.transaction) ?? str(body.id) ?? ''
    // Pro Hotmart o nome do EVENTO é a chave canônica (PURCHASE_APPROVED etc.);
    // o status entra como fallback.
    candidates = [str(body.event), currentStatus].filter(Boolean) as string[]
  } else {
    sale = body?.sale ?? {}
    product = body?.product ?? {}
    client = body?.client ?? {}
    orderId = str(sale.id) ?? str(body?.id) ?? ''
    currentStatus = str(body?.currentStatus) ?? str(sale.status) ?? null
    // A Voomp manda event=saleUpdated + currentStatus na mudança de status (e
    // um `trigger` em alguns webhooks). Tentamos trigger e currentStatus — o
    // que estiver no mapa vence (ex.: salePaid OU waiting_payment).
    candidates = [str(body?.trigger), currentStatus, str(body?.event)].filter(
      Boolean,
    ) as string[]
  }

  // Roteamento por PRODUTO (opcional). product_map:
  //   { "<id|nome do produto>": { pipeline_id, stage_map, recovery_template? } }
  // Assim UM webhook distribui cada produto pro seu funil. Sem match — ou
  // product_map vazio — cai no funil/mapa padrão da config (retrocompatível).
  const productMap = (cfg.product_map ?? {}) as Record<
    string,
    { pipeline_id?: string; stage_map?: Record<string, string>; recovery_template?: string | null }
  >
  const productKeys = [str(product.id), str(product.name)].filter(Boolean) as string[]
  const productRoute = productKeys.map((k) => productMap[k]).find(Boolean) ?? null

  let pipelineId = productRoute?.pipeline_id ?? null
  let stageMap = (productRoute?.stage_map ?? null) as Record<string, string> | null
  let recoveryTemplate = productRoute?.recovery_template ?? null

  // Auto-roteamento por NOME (opt-in): sem rota explícita no product_map,
  // casa o produto com um funil de mesmo nome e resolve as etapas pela
  // semântica dos nomes das etapas. Sem match único → cai no padrão.
  const productName = str(product.name)
  if (!pipelineId && cfg.auto_route_by_name && productName) {
    const { data: pipes } = await db
      .from('pipelines')
      .select('id, name')
      .eq('account_id', cfg.account_id)
    const match = pickPipelineByProduct(
      (pipes ?? []) as { id: string; name: string }[],
      productName,
    )
    if (match) {
      const { data: stgs } = await db
        .from('pipeline_stages')
        .select('id, name, position')
        .eq('pipeline_id', match.id)
        .order('position')
      pipelineId = match.id
      stageMap = autoStageMap((stgs ?? []) as { id: string; name: string; position: number }[])
      console.log(`[gateway] auto-route: produto "${productName}" → funil "${match.name}"`)
    }
  }

  // Fallback pro funil/mapa padrão da config.
  pipelineId = pipelineId ?? cfg.pipeline_id
  stageMap = stageMap ?? ((cfg.stage_map ?? {}) as Record<string, string>)
  recoveryTemplate = recoveryTemplate ?? cfg.recovery_template
  if (!pipelineId) return ack('no_pipeline', { product: productName })

  const eventKey = candidates.find((k) => k in stageMap) ?? 'unknown'
  const target = stageMap[eventKey]
  if (!target) {
    console.log('[gateway] evento sem mapeamento:', candidates, '— config', cfg.id)
    return ack('unmapped_trigger', { candidates })
  }

  // Idempotência: 1 processamento por (config, pedido, evento resolvido).
  if (orderId) {
    const { error: dupErr } = await db
      .from('gateway_events')
      .insert({ config_id: cfg.id, order_id: orderId, trigger: eventKey })
    if (dupErr && isUnique(dupErr)) return ack('duplicate', { order_id: orderId })
  }

  // owner da conta (preenche os user_id NOT NULL)
  const { data: acc } = await db
    .from('accounts').select('owner_user_id, default_currency').eq('id', cfg.account_id).maybeSingle()
  const ownerId = acc?.owner_user_id
  if (!ownerId) return ack('account_owner_missing')

  // Contato — dedup por phone_normalized (mesma chave do resto do CRM)
  const name = str(client.name) ?? 'Lead (gateway)'
  const phoneRaw = str(client.cellphone) ?? str(client.phone) ?? ''
  const phone = normalizePhone(phoneRaw)
  const email = str(client.email)

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
      .insert({ account_id: cfg.account_id, user_id: ownerId, phone: phoneRaw || phone, name, email })
      .select('id')
      .single()
    if (cErr || !created) {
      const { data: again } = await db
        .from('contacts').select('id').eq('account_id', cfg.account_id).eq('phone_normalized', phone).maybeSingle()
      if (!again) return ack('contact_failed', { err: cErr?.message })
      contactId = again.id
    } else {
      contactId = created.id
    }
  }

  // Tag do produto de interesse (ex.: "Rotina Que Vende")
  const productTag = str(product.name)
  await tagContact(db, cfg.account_id, ownerId, contactId, productTag)

  // Recuperação de venda (PIX pendente): tag "Recuperação" + dispara o
  // template aprovado; o agente da conta assume quando a pessoa responde.
  const isRecovery = currentStatus === 'waiting_payment' || /waiting|pix|pend|billet/i.test(eventKey)
  if (isRecovery && recoveryTemplate) {
    await tagContact(db, cfg.account_id, ownerId, contactId, 'Recuperação')
    await sendRecoveryTemplate({
      db,
      accountId: cfg.account_id,
      phoneRaw,
      name,
      productId: str(product.id),
      templateName: recoveryTemplate,
    }).catch((e) => console.error('[gateway] recovery send falhou', e))
  }

  // REFUND/revoga: marca o negócio desse contato no funil como perdido + tag
  if (target === 'refund') {
    await db
      .from('deals')
      .update({ status: 'lost' })
      .eq('account_id', cfg.account_id)
      .eq('pipeline_id', pipelineId)
      .eq('contact_id', contactId)
    await tagContact(db, cfg.account_id, ownerId, contactId, 'Reembolsado')
    return NextResponse.json({ ok: true, action: 'refund', contact_id: contactId }, { status: 200 })
  }

  // Venda/abandono. A Voomp dispara por produto, então a mesma pessoa pode
  // gerar vários eventos (abandonou → comprou). Mantemos UM negócio aberto
  // por contato no funil e só AVANÇAMOS de etapa (nunca puxamos pra trás —
  // nem por evento, nem desfazendo um avanço manual do time).
  const { data: targetStage } = await db
    .from('pipeline_stages').select('position').eq('id', target).maybeSingle()

  const { data: openDeal } = await db
    .from('deals')
    .select('id, stage_id')
    .eq('account_id', cfg.account_id)
    .eq('pipeline_id', pipelineId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (openDeal) {
    let advanced = false
    if (targetStage) {
      const { data: curStage } = await db
        .from('pipeline_stages').select('position').eq('id', openDeal.stage_id).maybeSingle()
      if (curStage && targetStage.position > curStage.position) {
        await db
          .from('deals')
          .update({ stage_id: target, updated_at: new Date().toISOString() })
          .eq('id', openDeal.id)
        advanced = true
      }
    }
    return NextResponse.json(
      { ok: true, action: eventKey, contact_id: contactId, deal_id: openDeal.id, advanced, tag: productTag },
      { status: 200 },
    )
  }

  const amount =
    typeof sale.amount === 'number'
      ? sale.amount
      : typeof product.amount === 'number'
        ? product.amount
        : 0
  const { data: deal } = await db
    .from('deals')
    .insert({
      account_id: cfg.account_id,
      user_id: ownerId,
      pipeline_id: pipelineId,
      stage_id: target,
      contact_id: contactId,
      title: `${productTag ?? 'Low Ticket'} — ${name}`,
      status: 'open',
      value: amount,
      currency: acc?.default_currency ?? 'BRL',
      notes: `Gateway ${cfg.provider} · pedido ${orderId} · ${eventKey}${str(sale.method) ? ` · ${sale.method}` : ''}`,
    })
    .select('id')
    .single()

  return NextResponse.json(
    { ok: true, action: eventKey, contact_id: contactId, deal_id: deal?.id ?? null, created: true, tag: productTag },
    { status: 200 },
  )
}
