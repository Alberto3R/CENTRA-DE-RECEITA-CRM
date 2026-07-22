import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

// ============================================================
// POST /api/meta/leadgen/conversions — devolução de conversões pro dataset
// (Conversion Leads / "Maximizar leads qualificados").
//
// Varre os deal_stage_events dos deals que nasceram de formulário nativo
// (meta_leadgen_leads) e ainda não foram enviados (meta_conversion_log), e
// posta cada entrada de etapa mapeada como evento CAPI no dataset ICP-3R-CCC,
// com match por lead_id (leadgen) + email/telefone hasheados.
//
// Chamado por pg_cron (migration 077). Auth: x-cron-secret ==
// app_config('leadgen_cron_secret'). Idempotente via meta_conversion_log
// (unique em stage_event_id) — reentrada não duplica evento.
// ============================================================

const GRAPH = 'https://graph.facebook.com/v21.0'
const DATASET_ID = '1372761034779700' // ICP-3R-CCC
const TOKEN_WABA = '824812527258696' // canal cujo system user token acessa o dataset

// entrada nessa etapa → evento no dataset (nomes que o mapeamento do
// Gerenciador de Eventos vai apontar como "qualificado"/"convertido")
const EVENT_BY_STAGE: Record<string, string> = {
  'Qualificado (verde)': 'lead_qualified',
  'Raio-X agendado': 'meeting_scheduled',
  Ganho: 'converted',
  'Off-gate / Perdido': 'disqualified',
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

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex')
}

async function sysToken(): Promise<string | null> {
  const { data } = await admin()
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

export async function POST(request: Request) {
  const db = admin()

  // auth do cron
  const { data: secretRow } = await db
    .from('app_config')
    .select('value')
    .eq('key', 'leadgen_cron_secret')
    .maybeSingle()
  const secret = (secretRow as { value?: string } | null)?.value
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 1. deals nascidos de formulário nativo
  const { data: links } = await db
    .from('meta_leadgen_leads')
    .select('deal_id, leadgen_id, account_id, contact_id')
    .not('deal_id', 'is', null)
    .limit(1000)
  if (!links?.length) return NextResponse.json({ ok: true, sent: 0 })
  const byDeal = new Map<string, { leadgen_id: string; account_id: string; contact_id: string | null }>()
  for (const l of links as { deal_id: string; leadgen_id: string; account_id: string; contact_id: string | null }[]) {
    byDeal.set(l.deal_id, l)
  }

  // 2. entradas de etapa ainda não enviadas
  const dealIds = [...byDeal.keys()]
  const { data: events } = await db
    .from('deal_stage_events')
    .select('id, deal_id, stage_id, entered_at')
    .in('deal_id', dealIds)
    .order('entered_at', { ascending: true })
    .limit(500)
  if (!events?.length) return NextResponse.json({ ok: true, sent: 0 })

  const eventIds = (events as { id: string }[]).map((e) => e.id)
  const { data: done } = await db
    .from('meta_conversion_log')
    .select('stage_event_id')
    .in('stage_event_id', eventIds)
  const doneSet = new Set(((done ?? []) as { stage_event_id: string }[]).map((d) => d.stage_event_id))
  const pending = (events as {
    id: string
    deal_id: string
    stage_id: string | null
    entered_at: string
  }[]).filter((e) => !doneSet.has(e.id) && e.stage_id)
  if (!pending.length) return NextResponse.json({ ok: true, sent: 0 })

  // 3. nomes das etapas + contatos (match reserva em/ph)
  const stageIds = [...new Set(pending.map((e) => e.stage_id as string))]
  const contactIds = [...new Set([...byDeal.values()].map((l) => l.contact_id).filter(Boolean))] as string[]
  const [{ data: stages }, { data: contacts }] = await Promise.all([
    db.from('pipeline_stages').select('id, name').in('id', stageIds),
    contactIds.length
      ? db.from('contacts').select('id, phone_normalized, email').in('id', contactIds)
      : Promise.resolve({ data: [] }),
  ])
  const stageName = new Map(((stages ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))
  const contactById = new Map(
    ((contacts ?? []) as { id: string; phone_normalized: string | null; email: string | null }[]).map(
      (c) => [c.id, c],
    ),
  )

  const token = await sysToken()
  if (!token) return NextResponse.json({ error: 'no token' }, { status: 500 })

  // 4. envia um a um (volume baixo; simplicidade > batch) e loga idempotência
  let sent = 0
  const results: Record<string, unknown>[] = []
  for (const ev of pending) {
    const stage = stageName.get(ev.stage_id as string)
    const eventName = stage ? EVENT_BY_STAGE[stage] : undefined
    const link = byDeal.get(ev.deal_id)!
    if (!eventName) {
      // etapa sem mapeamento (ex.: "Novo lead") — loga como pulada pra não revisitar
      await db.from('meta_conversion_log').insert({
        stage_event_id: ev.id,
        account_id: link.account_id,
        deal_id: ev.deal_id,
        event_name: `skip:${stage ?? 'sem-etapa'}`,
        dataset_id: DATASET_ID,
        ok: true,
        reason: 'stage_not_mapped',
      })
      continue
    }

    const userData: Record<string, unknown> = { lead_id: Number(link.leadgen_id) }
    const contact = link.contact_id ? contactById.get(link.contact_id) : null
    if (contact?.email) userData.em = [sha256(contact.email)]
    if (contact?.phone_normalized) userData.ph = [sha256(contact.phone_normalized)]

    const event = {
      event_name: eventName,
      event_time: Math.floor(new Date(ev.entered_at).getTime() / 1000),
      action_source: 'system_generated',
      user_data: userData,
    }

    let ok = false
    let reason: string | null = null
    try {
      const res = await fetch(
        `${GRAPH}/${DATASET_ID}/events?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: [event] }),
        },
      )
      ok = res.ok
      if (!res.ok) reason = `meta_${res.status}: ${(await res.text()).slice(0, 300)}`
    } catch (err) {
      reason = `fetch_failed: ${String(err).slice(0, 200)}`
    }

    // Só loga quando enviou — falha fica FORA do log pra ser retentada no
    // próximo cron (o log é o marcador de idempotência).
    if (ok) {
      await db.from('meta_conversion_log').insert({
        stage_event_id: ev.id,
        account_id: link.account_id,
        deal_id: ev.deal_id,
        event_name: eventName,
        dataset_id: DATASET_ID,
        ok: true,
      })
      sent++
    } else {
      console.error('[leadgen-conv] envio falhou', ev.id, reason)
    }
    results.push({ deal: ev.deal_id, stage, eventName, ok, reason })
  }

  return NextResponse.json({ ok: true, sent, processed: pending.length, results })
}
