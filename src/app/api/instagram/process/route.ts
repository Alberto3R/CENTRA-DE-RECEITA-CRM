// POST /api/instagram/process
//
// Roda as engines (flows / automations / agente de IA) para uma DM de
// Instagram que a Edge Function `ig-comment-webhook` já gravou em
// contacts/conversations/messages (ingestão Forma A).
//
// Como a ingestão IG roda na Edge Function (Deno) e as engines vivem aqui no
// Next, a Edge Function chama este endpoint depois de gravar a DM. Espelha o
// trecho final do webhook do WhatsApp (processMessage) — mesmo dispatch de
// flow → automations → agente, mas com o sender roteado por canal (Instagram).
//
// Autenticação: header x-ig-secret comparado ao segredo em ig_app_config
// (mesmo padrão do /broadcast/process). Não gated pelo middleware
// (middleware só protege /api/whatsapp/*), então valida o segredo aqui.

import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { maybeRunAgent } from '@/lib/ai-agent/handle'

export const maxDuration = 60

type AutomationTrigger =
  | 'new_contact_created'
  | 'first_inbound_message'
  | 'new_message_received'
  | 'keyword_match'

export async function POST(request: Request) {
  try {
    const supplied = request.headers.get('x-ig-secret')
    if (!supplied) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = supabaseAdmin()
    const { data: cfg } = await admin
      .from('ig_app_config')
      .select('value')
      .eq('key', 'ingest_secret')
      .maybeSingle()
    const expected = (cfg?.value as string | undefined) ?? undefined
    if (!expected) {
      return NextResponse.json({ error: 'ingest not configured' }, { status: 503 })
    }
    if (supplied !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const accountId = body?.accountId as string | undefined
    const userId = (body?.userId as string | undefined) ?? ''
    const conversationId = body?.conversationId as string | undefined
    const contactId = body?.contactId as string | undefined
    const channelId = body?.channelId as string | undefined
    const text = body?.text as string | undefined
    const metaMessageId = (body?.metaMessageId as string | undefined) ?? ''
    const wasContactCreated = body?.wasContactCreated === true

    if (!accountId || !conversationId || !contactId || !channelId || typeof text !== 'string') {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 })
    }

    // Ack rápido; roda as engines em after() (mantém a invocação viva na
    // Vercel até terminar), igual ao webhook do WhatsApp.
    after(
      processInboundIg({
        accountId,
        userId,
        conversationId,
        contactId,
        channelId,
        text,
        metaMessageId,
        wasContactCreated,
      }).catch((e) => console.error('[ig/process] erro no processamento:', e)),
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[ig/process] erro:', e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

async function processInboundIg(p: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  channelId: string
  text: string
  metaMessageId: string
  wasContactCreated: boolean
}): Promise<void> {
  const admin = supabaseAdmin()

  // A DM já foi inserida pela Edge Function — "primeira mensagem" = só há uma
  // mensagem do cliente nesta conversa.
  const { count } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', p.conversationId)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (count ?? 0) <= 1

  // 1. Flows têm prioridade — se consumirem a mensagem, suprimimos os
  //    gatilhos de conteúdo das automations (igual ao webhook).
  const flowResult = await dispatchInboundToFlows({
    accountId: p.accountId,
    userId: p.userId,
    contactId: p.contactId,
    conversationId: p.conversationId,
    message: { kind: 'text', text: p.text, meta_message_id: p.metaMessageId },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  // 2. Automations.
  const triggers: AutomationTrigger[] = []
  if (!flowConsumed) triggers.push('new_message_received', 'keyword_match')
  if (p.wasContactCreated) triggers.unshift('new_contact_created')
  if (isFirstInboundMessage) triggers.unshift('first_inbound_message')
  await Promise.all(
    triggers.map((triggerType) =>
      runAutomationsForTrigger({
        accountId: p.accountId,
        triggerType,
        contactId: p.contactId,
        context: { message_text: p.text, conversation_id: p.conversationId },
      }).catch((e) => console.error('[ig/process] automations:', e)),
    ),
  )

  // 3. Agente de IA — responde quando habilitado e nenhum flow consumiu.
  //    Para Instagram, maybeRunAgent resolve o canal internamente e envia pelo
  //    Messenger Platform; os campos de WhatsApp (contactWaId/phoneNumberId/
  //    accessToken) não são usados nesse caminho.
  if (!flowConsumed) {
    await maybeRunAgent({
      supabase: admin,
      accountId: p.accountId,
      conversationId: p.conversationId,
      contactWaId: '',
      phoneNumberId: '',
      channelId: p.channelId,
      accessToken: '',
      inboundText: p.text,
    })
  }
}
