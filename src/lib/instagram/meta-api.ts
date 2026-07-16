/**
 * Meta Instagram Messaging helpers (Messenger Platform).
 *
 * CRÍTICO (provado ao vivo em 16/jul/2026): o app "Sales 3R API" é
 * Facebook-Login/Página, então o envio de DM sai pelo Messenger Platform
 *   POST /{PAGE_ID}/messages
 * e NUNCA por /{IG_ID}/messages (essa é a variante Instagram-Login e
 * responde `(#3) Application does not have the capability`). Funciona em
 * Standard access, sem App Review, desde que dentro da janela de 24h.
 *
 * Como no `src/lib/whatsapp/meta-api.ts`, toda função recebe um único
 * objeto de parâmetros nomeados — um argumento trocado vira erro de
 * TypeScript em vez de uma rejeição silenciosa da Meta em runtime.
 */

const META_API_VERSION = 'v22.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface IgSendResult {
  /** message_id devolvido pelo Messenger Platform (guardado em messages.message_id). */
  messageId: string
}

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

/**
 * Graph às vezes devolve 200 com `{ error }` no corpo (não só non-2xx).
 * Lê o corpo uma vez e lança a mensagem da Meta em ambos os casos.
 */
async function parseGraphJson<T>(response: Response, fallback: string): Promise<T> {
  let data: (T & MetaErrorResponse) | null = null
  try {
    data = (await response.json()) as T & MetaErrorResponse
  } catch {
    // corpo não-JSON
  }
  if (data?.error?.message) throw new Error(data.error.message)
  if (!response.ok) throw new Error(fallback)
  if (data === null) throw new Error(fallback)
  return data
}

export interface GetInstagramPageTokenArgs {
  /** Facebook Page id ligada à conta IG (ex.: 152902442083026). */
  pageId: string
  /** Token de system user (permanente) com os scopes de mensagens. */
  systemUserToken: string
}

/**
 * Deriva o PAGE token a partir do token de system user:
 *   GET /{PAGE_ID}?fields=access_token&access_token={system-user token}
 * É esse page token que autoriza o envio pelo Messenger Platform.
 */
export async function getInstagramPageToken(
  args: GetInstagramPageTokenArgs,
): Promise<string> {
  const { pageId, systemUserToken } = args
  const url = `${META_API_BASE}/${pageId}?fields=access_token&access_token=${encodeURIComponent(
    systemUserToken,
  )}`
  const response = await fetch(url)
  const data = await parseGraphJson<{ access_token?: string }>(
    response,
    `Meta API error ao obter page token: ${response.status}`,
  )
  if (!data.access_token) {
    throw new Error('Meta não retornou access_token da Página.')
  }
  return data.access_token
}

export interface SendInstagramTextArgs {
  /** Facebook Page id — o envio é POST /{pageId}/messages. */
  pageId: string
  /** Page token (via getInstagramPageToken). */
  pageToken: string
  /** IGSID do destinatário (contacts.instagram_id / sender.id da DM). */
  igsid: string
  text: string
}

/**
 * Envia uma DM de texto livre. Só funciona dentro da janela de 24h após
 * a última mensagem do cliente (o chamador deve validar a janela antes).
 *
 * Resposta do Messenger Platform: `{ recipient_id, message_id }`.
 */
export async function sendInstagramText(
  args: SendInstagramTextArgs,
): Promise<IgSendResult> {
  const { pageId, pageToken, igsid, text } = args
  const url = `${META_API_BASE}/${pageId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pageToken}`,
    },
    body: JSON.stringify({
      recipient: { id: igsid },
      message: { text },
    }),
  })
  const data = await parseGraphJson<{ message_id?: string; recipient_id?: string }>(
    response,
    `Meta API error: ${response.status}`,
  )
  if (!data.message_id) {
    throw new Error('Meta não retornou message_id no envio da DM.')
  }
  return { messageId: data.message_id }
}
