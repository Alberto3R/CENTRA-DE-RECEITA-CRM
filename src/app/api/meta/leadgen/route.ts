import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import {
  processLeadgenEvent,
  type LeadgenValue,
} from '@/lib/meta/leadgen-import'

// ============================================================
// /api/meta/leadgen — webhook de Lead Ads (formulário nativo da Meta)
//
// GET  = verificação da assinatura do webhook (hub.challenge). O verify
//        token fica em app_config('leadgen_verify_token') — sem env nova.
// POST = evento `leadgen`: importa via lib/meta/leadgen-import (contato +
//        deal no estágio do gate + vínculo meta_leadgen_leads). O mesmo
//        núcleo roda no backfill (/backfill, pg_cron 10min), que recupera
//        leads perdidos por falha de entrega/leitura (ex.: Leads Access).
//
// Auth do POST: HMAC x-hub-signature-256 contra a lista META_APP_SECRET
// (mesma validação do webhook de WhatsApp).
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

async function appConfig(key: string): Promise<string | null> {
  const { data } = await admin().from('app_config').select('value').eq('key', key).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
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
    const db = admin()
    for (const v of values) {
      await processLeadgenEvent(db, v).catch((err) =>
        console.error('[leadgen] process erro', err),
      )
    }
  })
  return NextResponse.json({ ok: true })
}
