// Conversions API (CAPI) da Meta — dois disparos:
//
//  • fireConversion — conversão de lead de Click-to-WhatsApp (CTWA). Usa o
//    `ctwa_clid` capturado no webhook + action_source 'business_messaging'.
//    Dispara quando o deal entra num estágio de conversão (LeadSubmitted /
//    Purchase).
//
//  • fireWebLead — evento "Lead" web (action_source 'website') disparado
//    server-side quando a landing do Funil 2 posta um lead no /api/leads.
//    Substitui o disparo que o cenário do Make fazia, com dedup via
//    `event_id` (o mesmo do pixel do navegador).

import crypto from 'node:crypto'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'

const GRAPH = 'https://graph.facebook.com/v22.0'

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex')
}

interface CapiCfg {
  pixel_id: string
  capi_token: string
  test_event_code: string | null
}

// Config CAPI da conta (null se desligada/incompleta).
async function loadCfg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
): Promise<CapiCfg | null> {
  const { data: cfg } = await supabase
    .from('meta_capi_config')
    .select('enabled, pixel_id, capi_token, test_event_code')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!cfg?.enabled || !cfg.pixel_id || !cfg.capi_token) return null
  return cfg as CapiCfg
}

// Descriptografa o token e posta os eventos no pixel.
async function postEvents(
  cfg: CapiCfg,
  events: Record<string, unknown>[],
): Promise<{ ok: boolean; reason?: string }> {
  let token: string
  try {
    token = decrypt(cfg.capi_token)
  } catch {
    return { ok: false, reason: 'token_decrypt_failed' }
  }
  const body: Record<string, unknown> = { data: events }
  if (cfg.test_event_code) body.test_event_code = cfg.test_event_code
  try {
    const res = await fetch(
      `${GRAPH}/${cfg.pixel_id}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    if (!res.ok) {
      console.error('[capi] erro Meta', res.status, await res.text())
      return { ok: false, reason: `meta_${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[capi] fetch falhou', err)
    return { ok: false, reason: 'fetch_failed' }
  }
}

// ---------- CTWA (WhatsApp) ----------

export async function fireConversion(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  contactId: string
  eventName: string // 'LeadSubmitted' | 'Purchase' | ...
  value?: number
  currency?: string
}): Promise<{ ok: boolean; reason?: string }> {
  const { supabase, accountId, contactId, eventName, value, currency } = params

  const cfg = await loadCfg(supabase, accountId)
  if (!cfg) return { ok: false, reason: 'capi_not_configured' }

  // ctwa_clid mais recente do contato — sem ele não há atribuição CTWA
  const { data: attr } = await supabase
    .from('lead_attribution')
    .select('ctwa_clid')
    .eq('contact_id', contactId)
    .not('ctwa_clid', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const ctwaClid = attr?.ctwa_clid as string | undefined
  if (!ctwaClid) return { ok: false, reason: 'no_ctwa_clid' }

  // WABA da conta + telefone do contato (hash pra matching)
  const [wa, { data: contact }] = await Promise.all([
    resolveChannelConfig(supabase, accountId),
    supabase.from('contacts').select('phone_normalized').eq('id', contactId).maybeSingle(),
  ])

  const userData: Record<string, unknown> = { ctwa_clid: ctwaClid }
  if (wa?.waba_id) userData.whatsapp_business_account_id = wa.waba_id
  if (contact?.phone_normalized) userData.ph = [sha256(contact.phone_normalized)]

  const event: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: userData,
  }
  if (typeof value === 'number' && value > 0) {
    event.custom_data = { value, currency: currency ?? 'BRL' }
  }

  return postEvents(cfg, [event])
}

// ---------- Web (landing Funil 2) ----------

export async function fireWebLead(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  eventId?: string | null
  eventSourceUrl?: string | null
  fbc?: string | null
  fbp?: string | null
  fbclid?: string | null
  phone?: string | null // dígitos (E.164 sem +)
  email?: string | null
}): Promise<{ ok: boolean; reason?: string }> {
  const { supabase, accountId } = params

  const cfg = await loadCfg(supabase, accountId)
  if (!cfg) return { ok: false, reason: 'capi_not_configured' }

  const userData: Record<string, unknown> = {}
  // fbc: se a landing não mandou o cookie pronto mas tem o fbclid, monta o
  // formato esperado pela Meta (fb.1.<unixtime>.<fbclid>).
  let fbc = params.fbc ?? null
  if (!fbc && params.fbclid) fbc = `fb.1.${Math.floor(Date.now() / 1000)}.${params.fbclid}`
  if (fbc) userData.fbc = fbc
  if (params.fbp) userData.fbp = params.fbp
  if (params.phone) userData.ph = [sha256(params.phone.replace(/\D/g, ''))]
  if (params.email) userData.em = [sha256(params.email)]

  // Sem nenhum sinal de match (fbc/fbp/ph/em) a Meta descarta o evento.
  if (Object.keys(userData).length === 0) return { ok: false, reason: 'no_user_data' }

  const event: Record<string, unknown> = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: userData,
  }
  if (params.eventSourceUrl) event.event_source_url = params.eventSourceUrl
  // event_id = dedup com o evento que o pixel do navegador já disparou.
  if (params.eventId) event.event_id = params.eventId

  return postEvents(cfg, [event])
}
