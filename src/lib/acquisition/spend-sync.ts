// Sincroniza o gasto de mídia (Marketing API → ad_spend_daily, mig 113).
//
// Uma chamada de insights por conta de anúncio: level=ad, time_increment=1.
// Primeira sincronização puxa 90 dias; as seguintes reprocessam os últimos
// 3 dias (a Meta ajusta números depois). O token é o do system user da 3R —
// a conta de anúncio precisa estar atribuída a ele com ads_read; se não
// estiver, o erro fica em ad_accounts.last_sync_error e aparece na tela.

import { decrypt } from '@/lib/whatsapp/encryption'

const GRAPH = 'https://graph.facebook.com/v21.0'
// WABA cujo canal guarda o token do system user da 3R (mesmo do Lead Ads).
const TOKEN_WABA = '824812527258696'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface AdAccountRow {
  id: string
  account_id: string
  external_id: string
  last_synced_at: string | null
}

interface InsightRow {
  date_start: string
  ad_id: string
  ad_name?: string
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  campaign_name?: string
  spend?: string
  impressions?: string
  clicks?: string
  account_currency?: string
  actions?: { action_type: string; value: string }[]
}

// Ordem de preferência: `lead` já agrega pixel + formulário nativo + on-Meta.
const LEAD_ACTIONS = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.messaging_conversation_started_7d',
]

export function leadsFromActions(actions: InsightRow['actions']): number {
  if (!actions?.length) return 0
  for (const t of LEAD_ACTIONS) {
    const a = actions.find((x) => x.action_type === t)
    if (a) return Math.round(Number(a.value) || 0)
  }
  return 0
}

export function toSpendRow(r: InsightRow, ad: Pick<AdAccountRow, 'id' | 'account_id'>) {
  return {
    account_id: ad.account_id,
    ad_account_id: ad.id,
    date: r.date_start,
    campaign_id: r.campaign_id ?? null,
    campaign_name: r.campaign_name ?? null,
    adset_id: r.adset_id ?? null,
    adset_name: r.adset_name ?? null,
    ad_id: r.ad_id,
    ad_name: r.ad_name ?? null,
    spend: Number(r.spend ?? 0) || 0,
    currency: r.account_currency ?? null,
    impressions: Math.round(Number(r.impressions ?? 0) || 0),
    clicks: Math.round(Number(r.clicks ?? 0) || 0),
    meta_leads: leadsFromActions(r.actions),
    updated_at: new Date().toISOString(),
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Janela a sincronizar: 90 dias na primeira vez, 3 dias depois. */
export function syncWindow(lastSyncedAt: string | null, now = new Date()) {
  const days = lastSyncedAt ? 3 : 90
  const since = new Date(now.getTime() - days * 864e5)
  return { since: ymd(since), until: ymd(now) }
}

export async function systemUserToken(db: Db): Promise<string | null> {
  const { data } = await db
    .from('whatsapp_config')
    .select('access_token')
    .eq('waba_id', TOKEN_WABA)
    .eq('status', 'connected')
    .not('access_token', 'is', null)
    .limit(1)
    .maybeSingle()
  if (!data?.access_token) return null
  try {
    return decrypt(data.access_token as string)
  } catch {
    return null
  }
}

async function graph(url: string): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetch(url)
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const e = json.error as { message?: string; code?: number } | undefined
    return { ok: false, error: e?.message ? `${e.code ?? res.status}: ${e.message}` : `HTTP ${res.status}` }
  }
  return { ok: true, json }
}

export async function syncAdAccount(db: Db, token: string, ad: AdAccountRow) {
  const { since, until } = syncWindow(ad.last_synced_at)
  const act = `act_${ad.external_id}`
  const tk = encodeURIComponent(token)

  const info = await graph(`${GRAPH}/${act}?fields=name,currency&access_token=${tk}`)
  if (!info.ok) {
    await db.from('ad_accounts').update({ last_sync_error: info.error.slice(0, 300) }).eq('id', ad.id)
    return { ad_account: ad.external_id, ok: false, error: info.error }
  }

  const fields =
    'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency'
  let url: string | null =
    `${GRAPH}/${act}/insights?level=ad&time_increment=1&limit=500&fields=${fields}` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&access_token=${tk}`

  let rows = 0
  while (url) {
    const page = await graph(url)
    if (!page.ok) {
      await db.from('ad_accounts').update({ last_sync_error: page.error.slice(0, 300) }).eq('id', ad.id)
      return { ad_account: ad.external_id, ok: false, error: page.error, rows }
    }
    const data = ((page.json.data as InsightRow[]) ?? []).filter((r) => r.ad_id && r.date_start)
    if (data.length) {
      const { error } = await db
        .from('ad_spend_daily')
        .upsert(data.map((r) => toSpendRow(r, ad)), { onConflict: 'ad_account_id,date,ad_id' })
      if (error) {
        await db.from('ad_accounts').update({ last_sync_error: `db: ${error.message}`.slice(0, 300) }).eq('id', ad.id)
        return { ad_account: ad.external_id, ok: false, error: error.message, rows }
      }
      rows += data.length
    }
    url = ((page.json.paging as { next?: string } | undefined)?.next) ?? null
  }

  const meta = info.json as { name?: string; currency?: string }
  await db
    .from('ad_accounts')
    .update({
      name: meta.name ?? null,
      currency: meta.currency ?? null,
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq('id', ad.id)
  return { ad_account: ad.external_id, ok: true, since, until, rows }
}

/** Sincroniza as contas ativas (todas, ou só as de uma conta do CRM). */
export async function syncSpend(db: Db, opts: { accountId?: string } = {}) {
  const token = await systemUserToken(db)
  if (!token) return { ok: false, error: 'token do system user indisponível', results: [] }
  let q = db.from('ad_accounts').select('id, account_id, external_id, last_synced_at').eq('active', true)
  if (opts.accountId) q = q.eq('account_id', opts.accountId)
  const { data } = await q
  const results = []
  for (const ad of (data as AdAccountRow[]) ?? []) {
    try {
      results.push(await syncAdAccount(db, token, ad))
    } catch (e) {
      results.push({ ad_account: ad.external_id, ok: false, error: String(e) })
    }
  }
  return { ok: true, results }
}
