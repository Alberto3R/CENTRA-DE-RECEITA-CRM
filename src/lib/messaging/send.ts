/**
 * Envio de texto agnóstico de canal (WhatsApp, Instagram ou E-mail).
 *
 * As engines (automations, flows, agente de IA) já resolvem o canal da
 * conversa e gravam a própria linha em `messages` com o `sender_type` que faz
 * sentido pra elas ('bot'/'agent'). Este helper centraliza SÓ a decisão de
 * "por qual API mando esse texto" — sem tocar no banco — pra não duplicar a
 * ramificação WhatsApp-vs-Instagram em cada engine.
 *
 * WhatsApp mantém o retry por variante de telefone (mesma lógica do
 * sendViaMeta). Instagram deriva o page token e envia pelo Messenger Platform.
 * E-mail sai por SMTP (senha de app cifrada no canal) — ver lib/email/.
 *
 * ⚠️ O caminho de e-mail exige runtime Node (sockets TCP). `nodejs` já é o
 * default no Next 16.2.6; o cuidado é não marcar `runtime = 'edge'` numa rota
 * que possa cair no branch de e-mail.
 */

import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { isEmailChannel, toEmailChannel } from '@/lib/email/config'
import { enviarEmailSMTP } from '@/lib/email/outbound'
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
  email?: string | null
  name?: string | null
}

export interface SendTextResult {
  /** message_id do provedor (WhatsApp Cloud API, Messenger Platform, ou o
   *  Message-ID RFC 5322 no caso do e-mail). */
  providerMessageId: string
  /** Só WhatsApp: a variante de telefone que funcionou (o chamador pode
   *  persistir de volta no contato). Undefined nos outros canais. */
  workingPhone?: string
  /** Só e-mail: o assunto efetivamente usado — o chamador grava em
   *  `messages.subject`. */
  subject?: string
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
  /** Só e-mail. Assunto da mensagem. Se ausente, cai na cascata de fallback
   *  descrita em `assuntoDoEmail` — nunca sai e-mail sem assunto. */
  subject?: string | null
  /** Só e-mail. Message-ID da mensagem sendo respondida (liga a thread). */
  inReplyTo?: string | null
  /** Só e-mail. Cadeia de References da thread. */
  references?: string[] | null
  /** Só e-mail. Nome de exibição do remetente. */
  fromName?: string | null
}): Promise<SendTextResult> {
  const { channel, contact, text } = args
  if (!channel) throw new Error('canal não resolvido')

  // ── E-mail ─────────────────────────────────────────────────────────────
  if (isEmailChannel(channel)) {
    if (!contact.email) throw new Error('contato sem e-mail')
    const emailChannel = toEmailChannel(channel)
    const assunto = assuntoDoEmail(args.subject, emailChannel.label)
    const r = await enviarEmailSMTP({
      channel: emailChannel,
      para: contact.email,
      assunto,
      texto: text,
      remetenteNome: args.fromName ?? undefined,
      emRespostaA: args.inReplyTo,
      referencias: args.references,
    })
    if (r.rejeitados.length) {
      throw new Error(`SMTP rejeitou: ${r.rejeitados.join(', ')}`)
    }
    return { providerMessageId: r.messageId, subject: assunto }
  }

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

/**
 * Assunto do e-mail, em cascata:
 *   1. o que o chamador passou;
 *   2. o rótulo do canal (ex.: "Prospecção Sales 3R");
 *   3. um fallback genérico.
 *
 * Existe porque as engines antigas (automations, flows, agente de IA) chamam
 * `sendTextViaChannel` sem assunto — elas nasceram num mundo só de mensageria.
 * Em vez de quebrá-las, garantimos que nunca sai e-mail sem assunto (assunto
 * vazio é descarte quase certo no filtro de spam).
 *
 * Respostas dentro de uma thread devem passar o assunto explicitamente, já
 * prefixado com "Re: " — este fallback não sabe o histórico.
 */
export function assuntoDoEmail(
  informado?: string | null,
  rotuloDoCanal?: string | null,
): string {
  const limpo = informado?.trim()
  if (limpo) return limpo
  const rotulo = rotuloDoCanal?.trim()
  if (rotulo) return rotulo
  return 'Contato'
}
