/**
 * Cliente da Z-API para o canal de WhatsApp conectado por QR code.
 *
 * Uma instância Z-API = um número. As credenciais moram na linha do canal
 * (`whatsapp_config`): `qr_instance_id`, `access_token` (token da instância,
 * cifrado) e `qr_client_token` (token de segurança da conta, cifrado, vai no
 * header `Client-Token`). O cliente dos grupos (`lib/grupos/zapi.ts`) usa uma
 * instância fixa por env — este aqui é por canal.
 */
import { decrypt } from '@/lib/whatsapp/encryption'

const BASE = 'https://api.z-api.io/instances'

export interface ZapiCreds {
  instanceId: string
  token: string
  clientToken: string
}

export class ZapiError extends Error {
  readonly httpStatus: number
  constructor(message: string, httpStatus: number) {
    super(message)
    this.name = 'ZapiError'
    this.httpStatus = httpStatus
  }
}

/** Linha de `whatsapp_config` de um canal QR → credenciais em texto puro. */
export function zapiCredsFromChannel(channel: {
  qr_instance_id?: string | null
  access_token?: string | null
  qr_client_token?: string | null
}): ZapiCreds {
  if (!channel.qr_instance_id || !channel.access_token || !channel.qr_client_token) {
    throw new ZapiError('Canal de QR code sem credenciais da Z-API.', 500)
  }
  return {
    instanceId: channel.qr_instance_id,
    token: decrypt(channel.access_token),
    clientToken: decrypt(channel.qr_client_token),
  }
}

async function zapiFetch<T>(
  creds: ZapiCreds,
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
): Promise<T> {
  const url = `${BASE}/${creds.instanceId}/token/${creds.token}/${path}`
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'Client-Token': creds.clientToken,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  const err = (data as { error?: string; message?: string } | null)
  if (!res.ok) {
    throw new ZapiError(err?.error || err?.message || `Z-API respondeu ${res.status}`, res.status)
  }
  return data as T
}

// ── Instância ────────────────────────────────────────────────────────────

export interface ZapiStatus {
  connected: boolean
  smartphoneConnected?: boolean
  /** "You are not connected", "You need to restore the session"… */
  error?: string
}

export function getStatus(creds: ZapiCreds): Promise<ZapiStatus> {
  return zapiFetch<ZapiStatus>(creds, 'status')
}

/**
 * QR code da conexão. O WhatsApp troca o QR a cada ~20 s, então quem mostra
 * pede de novo. Alguns aparelhos pedem "chave de acesso" (passkey) em vez de
 * QR: aí vem `challenge` e a conexão tem que ser feita pelo painel da Z-API.
 */
export async function getQrImage(
  creds: ZapiCreds,
): Promise<{ image: string | null; challenge: boolean }> {
  const r = await zapiFetch<{ value?: string; challenge?: unknown }>(creds, 'qr-code/image')
  return { image: r?.value ?? null, challenge: Boolean(r?.challenge) }
}

/** Código de 8 letras para conectar digitando no celular (sem câmera). */
export async function getPhoneCode(
  creds: ZapiCreds,
  phone: string,
): Promise<{ code: string | null; challenge: boolean }> {
  const r = await zapiFetch<{ value?: string; challenge?: unknown }>(
    creds,
    `phone-code/${encodeURIComponent(phone)}`,
  )
  return { code: r?.value ?? null, challenge: Boolean(r?.challenge) }
}

export async function disconnect(creds: ZapiCreds): Promise<void> {
  await zapiFetch(creds, 'disconnect')
}

/**
 * Aponta TODOS os webhooks da instância (receber, status, conectar,
 * desconectar…) para a mesma URL. `notifySentByMe` faz o que o vendedor manda
 * pelo celular chegar também — vira mensagem "pelo celular" no inbox.
 */
export async function updateEveryWebhook(
  creds: ZapiCreds,
  url: string,
): Promise<void> {
  await zapiFetch(creds, 'update-every-webhooks', {
    method: 'PUT',
    body: { value: url, notifySentByMe: true },
  })
}

// ── Contatos ─────────────────────────────────────────────────────────────

/**
 * LID ("…@lid") de um telefone, pelo "Is on WhatsApp?" da Z-API. O caminho
 * contrário (LID → telefone) não existe: o WhatsApp esconde o número. É assim
 * que o eco de uma conversa que só chega por LID acha o cliente certo.
 * `null` quando o número não tem WhatsApp ou a Z-API não devolveu o LID.
 */
export async function lidOfPhone(creds: ZapiCreds, phone: string): Promise<string | null> {
  const r = await zapiFetch<unknown>(creds, `phone-exists/${encodeURIComponent(phone)}`)
  // A doc mostra ora um objeto, ora uma lista com um objeto.
  const item = (Array.isArray(r) ? r[0] : r) as { exists?: boolean; lid?: string | null } | null
  if (!item?.exists || !item.lid) return null
  const digits = item.lid.replace(/\D/g, '')
  return digits ? `${digits}@lid` : null
}

// ── Envio ────────────────────────────────────────────────────────────────

export interface ZapiSendResult {
  messageId: string
}

function pickId(r: { messageId?: string; id?: string; zaapId?: string } | null): string {
  const id = r?.messageId || r?.id
  if (!id) throw new ZapiError('Z-API não devolveu o id da mensagem.', 502)
  return id
}

export async function sendText(args: {
  creds: ZapiCreds
  phone: string
  text: string
  /** Id (Z-API) da mensagem citada — resposta a uma mensagem. */
  replyToId?: string
}): Promise<ZapiSendResult> {
  const r = await zapiFetch<{ messageId?: string; id?: string }>(args.creds, 'send-text', {
    method: 'POST',
    body: {
      phone: args.phone,
      message: args.text,
      ...(args.replyToId ? { messageId: args.replyToId } : {}),
    },
  })
  return { messageId: pickId(r) }
}

export type ZapiMediaKind = 'image' | 'video' | 'audio' | 'document'

/** Extensão do arquivo para o send-document (Z-API exige no caminho). */
export function documentExtension(filename?: string | null, link?: string | null): string {
  const fromName = filename?.split('.').pop()
  const fromLink = link?.split('?')[0]?.split('.').pop()
  const ext = (fromName && fromName !== filename ? fromName : fromLink) || 'pdf'
  return ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
}

export async function sendMedia(args: {
  creds: ZapiCreds
  phone: string
  kind: ZapiMediaKind
  /** Link público do arquivo (o mesmo que a Cloud API recebe). */
  link: string
  caption?: string
  filename?: string
  replyToId?: string
}): Promise<ZapiSendResult> {
  const { creds, phone, kind, link, caption, filename, replyToId } = args
  const reply = replyToId ? { messageId: replyToId } : {}
  let path: string
  let body: Record<string, unknown>
  switch (kind) {
    case 'image':
      path = 'send-image'
      body = { phone, image: link, caption: caption ?? '', ...reply }
      break
    case 'video':
      path = 'send-video'
      body = { phone, video: link, caption: caption ?? '', ...reply }
      break
    case 'audio':
      path = 'send-audio'
      body = { phone, audio: link }
      break
    default:
      path = `send-document/${documentExtension(filename, link)}`
      body = { phone, document: link, fileName: filename ?? undefined, caption, ...reply }
  }
  const r = await zapiFetch<{ messageId?: string; id?: string }>(creds, path, {
    method: 'POST',
    body,
  })
  return { messageId: pickId(r) }
}
