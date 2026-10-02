/**
 * Coexistência da Meta — o MESMO número no app WhatsApp Business do celular
 * e na Cloud API. Este módulo guarda as regras puras (sem banco) dos três
 * campos de webhook que só existem nesse modo:
 *
 *   smb_message_echoes  → o vendedor mandou mensagem PELO CELULAR
 *   history             → lote do histórico (até 180 dias) na conexão
 *   smb_app_state_sync  → agenda de contatos do app
 *
 * Quem grava no banco é o webhook (src/app/api/whatsapp/webhook/route.ts).
 * Plano completo em docs/WHATSAPP-BUSINESS-APP-CANAL.md.
 */
import { normalizePhone } from './phone-utils'

export const COEXISTENCE_WEBHOOK_FIELDS = [
  'smb_message_echoes',
  'history',
  'smb_app_state_sync',
] as const

export type CoexistenceWebhookField = (typeof COEXISTENCE_WEBHOOK_FIELDS)[number]

export function isCoexistenceWebhookField(
  field: string,
): field is CoexistenceWebhookField {
  return (COEXISTENCE_WEBHOOK_FIELDS as readonly string[]).includes(field)
}

/**
 * Mensagem no formato da Cloud API (type/text/image/…). Echo e histórico
 * reaproveitam o mesmo shape do `messages` normal — por isso o webhook
 * consegue passar pelo mesmo parseMessageContent.
 */
export interface CoexMessage {
  id: string
  from: string
  /** Só no echo: o cliente que recebeu a mensagem do vendedor. */
  to?: string
  timestamp: string
  type: string
  [key: string]: unknown
}

export interface CoexHistoryMessage extends CoexMessage {
  history_context?: { status?: string }
}

export interface CoexHistoryItem {
  metadata?: { phase?: number; chunk_order?: number; progress?: number }
  threads?: Array<{ id: string; messages?: CoexHistoryMessage[] }>
  /** O dono do número pode recusar o compartilhamento do histórico. */
  errors?: Array<{ code?: number; title?: string; message?: string }>
}

export interface CoexStateSyncItem {
  type: string
  contact?: { full_name?: string; first_name?: string; phone_number?: string }
  action?: 'add' | 'edit' | 'remove' | string
  metadata?: { timestamp?: string }
}

export interface CoexistenceValue {
  messaging_product: string
  metadata: { display_phone_number: string; phone_number_id: string }
  message_echoes?: CoexMessage[]
  history?: CoexHistoryItem[]
  state_sync?: CoexStateSyncItem[]
}

/** Valores aceitos pelo CHECK de messages.status. */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'

/**
 * Status do histórico (history_context.status) → messages.status.
 * PLAYED é áudio ouvido: para o CRM, "lido".
 */
export function mapHistoryStatus(status: string | undefined): MessageStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'READ':
    case 'PLAYED':
      return 'read'
    case 'DELIVERED':
      return 'delivered'
    case 'ERROR':
      return 'failed'
    case 'PENDING':
      return 'sending'
    default:
      return 'sent'
  }
}

/**
 * Quem escreveu a mensagem do histórico: o próprio número da empresa (o
 * vendedor, no celular) ou o cliente. Compara só dígitos — a Meta manda
 * `display_phone_number` sem "+" e às vezes com espaços/hífen.
 */
export function isFromBusiness(from: string, businessPhone: string): boolean {
  const a = normalizePhone(from)
  const b = normalizePhone(businessPhone)
  return a !== '' && a === b
}

/**
 * Mesma regra do insert de mensagem recebida: o CHECK de content_type não
 * conhece sticker/reaction/contacts/etc. Sticker é imagem; o resto vira texto.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'text', 'image', 'document', 'audio', 'video',
  'location', 'template', 'interactive',
])

export function toContentType(type: string): string {
  if (ALLOWED_CONTENT_TYPES.has(type)) return type
  if (type === 'sticker') return 'image'
  return 'text'
}

/** Histórico concluído = última fase com 100%. */
export function isHistoryComplete(item: CoexHistoryItem): boolean {
  const phase = item.metadata?.phase
  const progress = item.metadata?.progress
  return phase === 2 && progress === 100
}

/** Texto legível do erro de histórico (dono recusou, prazo expirou etc.). */
export function historyErrorText(item: CoexHistoryItem): string | null {
  const err = item.errors?.[0]
  if (!err) return null
  const text = err.title || err.message || 'Falha no histórico'
  return err.code != null ? `${text} (código ${err.code})` : text
}

/** Mensagem mais recente de um lote — para o "última mensagem" da conversa. */
export function latestMessage<T extends { timestamp: string }>(
  messages: T[],
): T | null {
  let best: T | null = null
  for (const m of messages) {
    if (!best || Number(m.timestamp) > Number(best.timestamp)) best = m
  }
  return best
}

export function timestampToIso(ts: string): string {
  return new Date(parseInt(ts, 10) * 1000).toISOString()
}
