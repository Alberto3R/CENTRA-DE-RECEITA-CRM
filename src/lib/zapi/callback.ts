/**
 * Webhooks da Z-API → formato interno do CRM. Só regras puras (sem banco),
 * para o webhook (`/api/whatsapp/webhook?zapi=<segredo>`) reaproveitar o mesmo
 * processamento das mensagens da Cloud API.
 *
 * Um único URL recebe todos os eventos; o campo `type` diz qual é:
 *   ReceivedCallback       mensagem recebida (ou enviada pelo celular, fromMe)
 *   MessageStatusCallback  enviada / entregue / lida
 *   ConnectedCallback      o QR foi escaneado
 *   DisconnectedCallback   a sessão caiu
 * Exemplos de payload: developer.z-api.io/webhooks/on-message-received-examples
 */
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

export interface ZapiReceivedCallback {
  type: 'ReceivedCallback'
  instanceId?: string
  messageId?: string
  phone?: string
  /** LID da conversa (…@lid): o id estável do contato no WhatsApp. */
  chatLid?: string | null
  /** LID de quem mandou — no fromMe é o do próprio número conectado. */
  senderLid?: string | null
  /** Só em grupo: quem do grupo falou. */
  participantPhone?: string | null
  participantLid?: string | null
  fromMe?: boolean
  /** true quando a mensagem saiu pela própria API (nós). */
  fromApi?: boolean
  /** Milissegundos. */
  momment?: number
  isGroup?: boolean
  isNewsletter?: boolean
  broadcast?: boolean
  isStatusReply?: boolean
  waitingMessage?: boolean
  isEdit?: boolean
  chatName?: string
  senderName?: string
  connectedPhone?: string
  referenceMessageId?: string | null
  /** Ligação, evento de grupo, troca de foto… — não é mensagem. */
  notification?: string | null
  text?: { message?: string }
  image?: { imageUrl?: string; caption?: string; mimeType?: string }
  audio?: { audioUrl?: string; mimeType?: string }
  video?: { videoUrl?: string; caption?: string; mimeType?: string }
  document?: { documentUrl?: string; fileName?: string; title?: string; caption?: string; mimeType?: string }
  sticker?: { stickerUrl?: string; mimeType?: string }
  location?: { latitude?: number; longitude?: number; name?: string; address?: string }
  contact?: { displayName?: string; vCard?: string; phones?: string[] }
  reaction?: { value?: string; referencedMessage?: { messageId?: string } }
  buttonsResponseMessage?: { buttonId?: string; message?: string }
  listResponseMessage?: { selectedRowId?: string; title?: string; message?: string }
  externalAdReply?: {
    title?: string
    body?: string
    sourceType?: string
    sourceId?: string
    sourceUrl?: string
    ctwaClid?: string
  } | null
}

export interface ZapiStatusCallback {
  type: 'MessageStatusCallback'
  instanceId?: string
  status?: string
  ids?: string[]
  momment?: number
  phone?: string
  isGroup?: boolean
}

export interface ZapiConnectedCallback {
  type: 'ConnectedCallback'
  instanceId?: string
  connected?: boolean
  phone?: string
  momment?: number
}

export interface ZapiDisconnectedCallback {
  type: 'DisconnectedCallback'
  instanceId?: string
  disconnected?: boolean
  error?: string
  momment?: number
}

export type ZapiCallback =
  | ZapiReceivedCallback
  | ZapiStatusCallback
  | ZapiConnectedCallback
  | ZapiDisconnectedCallback

/** Mensagem já traduzida, pronta para gravar. */
export interface ZapiMessage {
  id: string
  /** Telefone do cliente, só dígitos. `null` quando a Z-API só mandou o LID —
   *  o que acontece muito no eco do que o vendedor manda pelo celular. */
  phone: string | null
  /** LID do cliente ("171459523662078@lid"), quando veio. */
  lid: string | null
  /** Nome que o cliente usa no WhatsApp ('' quando é o vendedor falando). */
  name: string
  /** Nome da conversa no celular — no eco, é como o vendedor vê o cliente. */
  chatName: string
  /** Mandada pelo vendedor no celular (não pelo CRM). */
  fromPhone: boolean
  /** Segundos, em string — o formato do `timestamp` da Cloud API. */
  timestamp: string
  /** Tipo no vocabulário da Cloud API (text, image, audio, video, document,
   *  sticker, location, contacts, reaction, interactive). */
  type: string
  contentText: string | null
  mediaUrl: string | null
  interactiveReplyId: string | null
  /** Id (Z-API) da mensagem citada. */
  replyToId: string | null
  reaction: { emoji: string; targetId: string } | null
  /** Lead de anúncio Click-to-WhatsApp — mesmo shape do `referral` da Meta. */
  referral: {
    source_url?: string
    source_id?: string
    source_type?: string
    headline?: string
    body?: string
    ctwa_clid?: string
  } | null
}

/**
 * O `phone` da Z-API é o id da CONVERSA: número, grupo ("…-group"), canal
 * ("…@newsletter"), lista de transmissão ("…-broadcast") ou Status
 * ("status@broadcast" — os stories dos contatos, que chegam sem `isGroup`
 * nem `broadcast` e viravam um contato sem telefone por mensagem).
 * Só número e LID são conversa 1:1.
 */
export function isOneToOneChatId(raw: string | null | undefined): boolean {
  const id = (raw || '').trim().toLowerCase()
  if (!id) return false
  if (id.endsWith('-group') || id.endsWith('@g.us')) return false
  if (id.endsWith('@newsletter')) return false
  if (id.endsWith('-broadcast') || id.endsWith('@broadcast')) return false
  if (id.includes('@') && !id.endsWith('@lid') && !id.endsWith('@s.whatsapp.net')) return false
  return /\d/.test(id)
}

/** "171459523662078@lid" / "171459523662078" → "171459523662078@lid". */
export function toLid(raw: string | null | undefined): string | null {
  const id = (raw || '').trim().toLowerCase()
  if (!id.endsWith('@lid')) return null
  const digits = normalizePhone(id)
  return digits ? `${digits}@lid` : null
}

/** Telefone e LID do cliente da conversa. Os dois podem vir, ou só um. */
function customerIds(cb: ZapiReceivedCallback): { phone: string | null; lid: string | null } {
  const raw = (cb.phone || '').trim()
  const phoneIsLid = raw.toLowerCase().endsWith('@lid')
  const phone = phoneIsLid ? null : normalizePhone(raw) || null
  // No fromMe o senderLid é o do vendedor, não o do cliente.
  const lid =
    toLid(cb.chatLid) ??
    (phoneIsLid ? toLid(raw) : null) ??
    (cb.fromMe ? null : toLid(cb.senderLid))
  return { phone, lid }
}

function contactCardText(c: NonNullable<ZapiReceivedCallback['contact']>): string {
  const phones = (c.phones ?? []).filter(Boolean).join(', ')
  return [`📇 ${c.displayName || 'Contato'}`, phones ? `📱 ${phones}` : null]
    .filter(Boolean)
    .join('\n')
}

/**
 * ReceivedCallback → mensagem do CRM. `null` = ignorar: grupo, canal, lista de
 * transmissão, Status, resposta a status, aviso de sistema (ligação, grupo),
 * mensagem ainda cifrada ("aguardando mensagem"), o eco do que o próprio CRM
 * mandou pela API (já está gravado) ou mensagem sem telefone nem LID.
 */
export function parseZapiReceived(cb: ZapiReceivedCallback): ZapiMessage | null {
  if (cb.type !== 'ReceivedCallback') return null
  if (cb.isGroup || cb.isNewsletter || cb.broadcast || cb.isStatusReply) return null
  if (cb.notification || cb.waitingMessage) return null
  if (cb.fromMe && cb.fromApi) return null
  if (!cb.messageId) return null
  // Grupo pode chegar sem isGroup: quem falou dentro dele vem em participant*.
  if (!isOneToOneChatId(cb.phone) || cb.participantPhone || cb.participantLid) return null
  const { phone, lid } = customerIds(cb)
  if (!phone && !lid) return null

  const base: ZapiMessage = {
    id: cb.messageId,
    phone,
    lid,
    name: cb.fromMe ? '' : (cb.senderName || cb.chatName || '').trim(),
    chatName: (cb.chatName || '').trim(),
    fromPhone: Boolean(cb.fromMe),
    timestamp: String(Math.floor((cb.momment ?? Date.now()) / 1000)),
    type: 'text',
    contentText: null,
    mediaUrl: null,
    interactiveReplyId: null,
    replyToId: cb.referenceMessageId || null,
    reaction: null,
    referral: null,
  }

  const ad = cb.externalAdReply
  if (ad && (ad.ctwaClid || ad.sourceId)) {
    base.referral = {
      source_url: ad.sourceUrl,
      source_id: ad.sourceId,
      source_type: ad.sourceType,
      headline: ad.title,
      body: ad.body,
      ctwa_clid: ad.ctwaClid,
    }
  }

  if (cb.reaction) {
    const targetId = cb.reaction.referencedMessage?.messageId
    if (!targetId) return null
    return {
      ...base,
      type: 'reaction',
      contentText: cb.reaction.value || null,
      reaction: { emoji: cb.reaction.value || '', targetId },
    }
  }
  if (cb.buttonsResponseMessage) {
    const b = cb.buttonsResponseMessage
    return {
      ...base,
      type: 'interactive',
      contentText: b.message || b.buttonId || '[Botão]',
      interactiveReplyId: b.buttonId ?? null,
    }
  }
  if (cb.listResponseMessage) {
    const l = cb.listResponseMessage
    return {
      ...base,
      type: 'interactive',
      contentText: l.title || l.message || l.selectedRowId || '[Lista]',
      interactiveReplyId: l.selectedRowId ?? null,
    }
  }
  if (cb.image) {
    return { ...base, type: 'image', contentText: cb.image.caption || null, mediaUrl: cb.image.imageUrl || null }
  }
  if (cb.video) {
    return { ...base, type: 'video', contentText: cb.video.caption || null, mediaUrl: cb.video.videoUrl || null }
  }
  if (cb.audio) {
    return { ...base, type: 'audio', mediaUrl: cb.audio.audioUrl || null }
  }
  if (cb.document) {
    const d = cb.document
    return {
      ...base,
      type: 'document',
      contentText: d.caption || d.fileName || d.title || null,
      mediaUrl: d.documentUrl || null,
    }
  }
  if (cb.sticker) {
    return { ...base, type: 'sticker', mediaUrl: cb.sticker.stickerUrl || null }
  }
  if (cb.location) {
    const loc = cb.location
    const text = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
      .filter(Boolean)
      .join(' - ')
    return { ...base, type: 'location', contentText: text }
  }
  if (cb.contact) {
    return { ...base, type: 'contacts', contentText: contactCardText(cb.contact) }
  }
  if (cb.text) {
    return { ...base, type: 'text', contentText: cb.text.message || null }
  }
  return { ...base, contentText: '[Mensagem não suportada]' }
}

/** Status da Z-API → status da Cloud API (o que o CRM já entende). */
export function mapZapiStatus(status: string | undefined): 'sent' | 'delivered' | 'read' | null {
  switch ((status ?? '').toUpperCase()) {
    case 'SENT':
      return 'sent'
    case 'RECEIVED':
      return 'delivered'
    case 'READ':
    case 'PLAYED':
      return 'read'
    default:
      // READ_BY_ME (o vendedor leu no celular) e PENDING não mudam o status.
      return null
  }
}

/** Telefone conectado ("5531997729804") → "+55 31 99772-9804" para exibir. */
export function formatConnectedPhone(phone: string | undefined | null): string | null {
  const d = normalizePhone(phone || '')
  if (!d) return null
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${d}`
}
