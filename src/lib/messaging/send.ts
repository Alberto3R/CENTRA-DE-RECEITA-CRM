/**
 * Envio de texto agnóstico de canal (WhatsApp ou Instagram).
 *
 * As engines (automations, flows, agente de IA) já resolvem o canal da
 * conversa e gravam a própria linha em `messages` com o `sender_type` que faz
 * sentido pra elas ('bot'/'agent'). Este helper centraliza SÓ a decisão de
 * "por qual API mando esse texto" — sem tocar no banco — pra não duplicar a
 * ramificação WhatsApp-vs-Instagram em cada engine.
 *
 * WhatsApp mantém o retry por variante de telefone (mesma lógica do
 * sendViaMeta). Instagram deriva o page token e envia pelo Messenger Platform.
 */

import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { getInstagramPageToken, sendInstagramText } from '@/lib/instagram/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'

// Linha de `whatsapp_config` já resolvida (via resolveChannelConfig).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResolvedChannel = Record<string, any>

export function isInstagramChannel(
  channel: ResolvedChannel | null | undefined,
): boolean {
  return channel?.channel_type === 'instagram'
}

export interface ChannelContact {
  phone?: string | null
  instagram_id?: string | null
}

export interface SendTextResult {
  /** message_id do provedor (WhatsApp Cloud API ou Messenger Platform). */
  providerMessageId: string
  /** Só WhatsApp: a variante de telefone que funcionou (o chamador pode
   *  persistir de volta no contato). Undefined no Instagram. */
  workingPhone?: string
}

/**
 * Envia um texto livre pelo canal certo. NÃO grava no banco — o chamador
 * insere a mensagem com o sender_type apropriado.
 *
 * Lança em erro (contato sem identidade no canal, canal mal configurado, ou
 * rejeição da Meta) — o chamador (engine) já loga e segue.
 */
export async function sendTextViaChannel(args: {
  channel: ResolvedChannel | null
  contact: ChannelContact
  text: string
}): Promise<SendTextResult> {
  const { channel, contact, text } = args
  if (!channel) throw new Error('canal não resolvido')

  // ── Instagram ──────────────────────────────────────────────────────────
  if (isInstagramChannel(channel)) {
    if (!contact.instagram_id) throw new Error('contato sem instagram_id')
    if (!channel.ig_page_id) throw new Error('canal Instagram sem ig_page_id')
    const systemUserToken = decrypt(channel.access_token)
    const pageToken = await getInstagramPageToken({
      pageId: channel.ig_page_id,
      systemUserToken,
    })
    const r = await sendInstagramText({
      pageId: channel.ig_page_id,
      pageToken,
      igsid: contact.instagram_id,
      text,
    })
    return { providerMessageId: r.messageId }
  }

  // ── WhatsApp ───────────────────────────────────────────────────────────
  if (!contact.phone) throw new Error('contato sem telefone')
  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) throw new Error(`telefone inválido: ${contact.phone}`)
  const accessToken = decrypt(channel.access_token)

  let lastError: unknown = null
  for (const variant of phoneVariants(sanitized)) {
    try {
      const r = await sendTextMessage({
        phoneNumberId: channel.phone_number_id,
        accessToken,
        to: variant,
        text,
      })
      return { providerMessageId: r.messageId, workingPhone: variant }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  throw lastError ?? new Error('envio falhou para todas as variantes de telefone')
}
