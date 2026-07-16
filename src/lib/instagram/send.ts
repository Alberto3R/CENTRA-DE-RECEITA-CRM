/**
 * Envio de resposta manual numa conversa de Instagram Direct (Fase 1).
 *
 * Espelha a lógica de `src/app/api/whatsapp/send/route.ts`, mas para o
 * canal Instagram: sem telefone, sem templates/mídia (Fase 2), e com a
 * regra de janela de 24h da Meta aplicada aqui no servidor (a UI só mostra
 * o badge). O sender concreto vive em `src/lib/instagram/meta-api.ts`.
 *
 * Mantido fora do route handler para dar um ponto de costura limpo às
 * engines (automations/flows/agente) roteadas por canal na Fase 2.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getInstagramPageToken, sendInstagramText } from '@/lib/instagram/meta-api'

/** Janela de mensagem padrão da Meta para DMs (texto livre). */
const IG_WINDOW_HOURS = 24

export interface SendInstagramReplyArgs {
  /** Cliente Supabase com acesso à conta (mesmo usado no route do WhatsApp). */
  supabase: SupabaseClient
  accountId: string
  conversation: {
    id: string
    channel_id?: string | null
  }
  contact: {
    id: string
    instagram_id?: string | null
  }
  text: string
}

export interface SendInstagramReplyResult {
  ok: boolean
  /** HTTP status sugerido para o route handler devolver. */
  status: number
  /** id interno da linha em `messages` (quando ok). */
  messageId?: string
  /** message_id da Meta (quando ok). */
  igMessageId?: string
  error?: string
}

/**
 * Verdadeiro quando a janela de 24h ainda está aberta — i.e. há uma
 * mensagem do cliente (`sender_type='customer'`) nas últimas 24h.
 */
export function isInstagramWindowOpen(
  lastInboundAtIso: string | null | undefined,
): boolean {
  if (!lastInboundAtIso) return false
  const ageMs = Date.now() - new Date(lastInboundAtIso).getTime()
  return ageMs <= IG_WINDOW_HOURS * 60 * 60 * 1000
}

export async function sendInstagramReply(
  args: SendInstagramReplyArgs,
): Promise<SendInstagramReplyResult> {
  const { supabase, accountId, conversation, contact, text } = args

  const igsid = contact.instagram_id
  if (!igsid) {
    return { ok: false, status: 400, error: 'Contato sem identidade Instagram (instagram_id).' }
  }
  if (!text || !text.trim()) {
    return { ok: false, status: 400, error: 'content_text é obrigatório.' }
  }

  // Resolve o canal desta conversa e confirma que é Instagram.
  const channel = await resolveChannelConfig(
    supabase,
    accountId,
    conversation.channel_id,
  )
  if (!channel || channel.channel_type !== 'instagram' || !channel.ig_page_id) {
    return {
      ok: false,
      status: 400,
      error: 'Canal Instagram não configurado para esta conversa.',
    }
  }

  // Janela de 24h — precisa de uma DM recebida recente para responder em
  // texto livre. Sem isso a Meta rejeita (fora de human_agent, que é Fase 2).
  const { data: lastInbound } = await supabase
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!isInstagramWindowOpen(lastInbound?.created_at)) {
    return {
      ok: false,
      status: 409,
      error:
        'Janela de 24h expirada. O cliente precisa enviar uma nova DM para reabrir a conversa.',
    }
  }

  // Envia via Messenger Platform (POST /{ig_page_id}/messages).
  let igMessageId: string
  try {
    const systemUserToken = decrypt(channel.access_token)
    const pageToken = await getInstagramPageToken({
      pageId: channel.ig_page_id,
      systemUserToken,
    })
    const result = await sendInstagramText({
      pageId: channel.ig_page_id,
      pageToken,
      igsid,
      text,
    })
    igMessageId = result.messageId
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido na Meta API'
    console.error('[instagram/send] falhou:', message)
    return { ok: false, status: 502, error: `Instagram API: ${message}` }
  }

  // Grava a mensagem enviada. Mesmos campos do route do WhatsApp.
  const { data: messageRecord, error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'agent',
      content_type: 'text',
      content_text: text,
      message_id: igMessageId,
      status: 'sent',
    })
    .select()
    .single()

  if (msgError) {
    console.error('[instagram/send] enviado à Meta mas falhou ao salvar:', msgError)
    return {
      ok: false,
      status: 500,
      error: `Mensagem enviada, mas falhou ao salvar no banco: ${msgError.message}`,
    }
  }

  // Um humano respondendo é o sinal mais forte de "assumi o atendimento":
  // pausa a IA nativa nesta conversa (mesmo efeito do route do WhatsApp).
  await supabase
    .from('conversations')
    .update({
      last_message_text: text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ai_handoff: true,
    })
    .eq('id', conversation.id)

  return {
    ok: true,
    status: 200,
    messageId: messageRecord.id,
    igMessageId,
  }
}
