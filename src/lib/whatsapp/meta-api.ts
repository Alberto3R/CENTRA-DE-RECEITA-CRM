/**
 * Meta WhatsApp Cloud API helpers.
 *
 * Every function takes a single options object (named parameters) instead
 * of positional arguments. This was a deliberate choice after the same
 * swapped-args bug was found four times in a row with the positional form
 * (e.g. `(accessToken, phoneNumberId)` vs `(phoneNumberId, accessToken)`).
 * With named params, a typo surfaces immediately as a TypeScript error
 * instead of a runtime rejection from Meta.
 */

const META_API_VERSION = 'v22.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
  messageId: string
}

export interface MetaPhoneInfo {
  id: string
  display_phone_number: string
  verified_name?: string
  quality_rating?: string
  /** CONNECTED quando o número está registrado e ativo na Cloud API. */
  status?: string
  /** CLOUD_API quando o número roda na Cloud API (vs. on-premise). */
  platform_type?: string
  /**
   * VERIFIED / EXPIRED / NOT_VERIFIED. É o campo que decide o caminho da
   * ativação: VERIFIED vai direto pro /register; EXPIRED exige re-verificar
   * o número com o código físico (SMS ou ligação) ANTES do /register.
   * Sem ele não dá pra rotear — por isso ele entra no fields do diagnóstico.
   */
  code_verification_status?: string
}

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string; error_subcode?: number }
}

/**
 * Erro da Graph API com o código preservado.
 *
 * Antes todo erro virava `new Error(message)` e quem chamava tinha que
 * adivinhar a causa por regex na mensagem — frágil, porque a Meta reescreve
 * esses textos e traduz alguns. O fluxo de ativação roteia por CÓDIGO
 * (100/33 = objeto invisível pro token, 133005 = já registrado,
 * 133010 = não registrado, 139xxx = 2SV), então o código precisa sobreviver
 * até o chamador.
 */
export class MetaApiError extends Error {
  readonly code?: number
  readonly subcode?: number
  readonly httpStatus: number

  constructor(
    message: string,
    opts: { code?: number; subcode?: number; httpStatus: number }
  ) {
    super(message)
    this.name = 'MetaApiError'
    this.code = opts.code
    this.subcode = opts.subcode
    this.httpStatus = opts.httpStatus
  }

  /**
   * "Esse ID não é um Phone Number ID que este token enxerga."
   *
   * Dois formatos reais da Meta caem aqui:
   *   * 100 / subcode 33 — "does not exist, or you do not have permission";
   *   * 100 sem subcode, mensagem "Tried accessing nonexisting field
   *     (display_phone_number) on node type (WhatsAppBusinessAccount)" —
   *     é o que a Graph responde quando o ID É um WABA ID e a gente pediu
   *     campos de número. Esse é o caso mais comum no onboarding.
   *
   * Em ambos, o próximo passo é o mesmo: tentar listar os números do ID
   * (PASSO 1B) antes de culpar o token.
   */
  get isObjectNotVisible(): boolean {
    if (this.code !== 100) return false
    if (this.subcode === 33) return true
    return /nonexisting field|does not exist/i.test(this.message)
  }
}

// Dicas em PT-BR por código de erro da Meta — anexadas à mensagem de erro
// para que qualquer envio (send/broadcast/template) explique a CAUSA e a
// CORREÇÃO em vez de só o código cru. Ponto único: todo envio passa por aqui.
const META_ERROR_HINTS: Record<number, string> = {
  133010:
    'O número não está registrado na Cloud API. Registre-o em Configurações → WhatsApp (informe o PIN de verificação em duas etapas e clique em Salvar configuração).',
  131047:
    'Fora da janela de 24h — para reabrir a conversa é preciso enviar um TEMPLATE aprovado (mensagem livre só dentro das 24h após a última resposta do contato).',
  131051: 'Tipo de mensagem não suportado para este envio.',
  131026:
    'Mensagem não entregável — confira se o número existe no WhatsApp; fora da janela de 24h, só com template aprovado.',
  190: 'Token de acesso inválido ou expirado — reconecte o canal em Configurações → WhatsApp.',
  131056:
    'Muitas mensagens para este contato em pouco tempo (limite de pares da Meta) — aguarde um pouco e tente de novo.',
  132000:
    'Os parâmetros enviados não batem com o template aprovado — confira o número de variáveis {{1}}, {{2}}… e os botões.',
  132001:
    'Template não existe ou não está aprovado neste idioma — verifique o nome e o status em Modelos.',
  132015: 'Este template está pausado pela Meta por baixa qualidade.',
  132016: 'Este template foi desabilitado pela Meta.',
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code: number | undefined
  let subcode: number | undefined
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
    code = data.error?.code
    subcode = data.error?.error_subcode
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  const hint = code != null ? META_ERROR_HINTS[code] : undefined
  if (hint) message = `${message} — ${hint}`
  throw new MetaApiError(message, { code, subcode, httpStatus: response.status })
}

// ============================================================
// Phone number / account
// ============================================================

export interface VerifyPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
}

/**
 * Verify a Meta phone number ID by fetching its public metadata
 * (display_phone_number, verified_name, quality_rating).
 */
export async function verifyPhoneNumber(
  args: VerifyPhoneNumberArgs
): Promise<MetaPhoneInfo> {
  const { phoneNumberId, accessToken } = args
  const url = `${META_API_BASE}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,status,platform_type,code_verification_status`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// Cloud API registration (subscription for inbound webhooks)
// ============================================================
//
// Saving a phone_number_id + access_token to whatsapp_config is NOT
// enough to receive inbound events from Meta. Two extra calls are
// required:
//
//   POST /{phone_number_id}/register
//     Subscribes the number for THIS app's webhook. Requires a
//     6-digit 2FA PIN the user previously set in Meta WhatsApp
//     Manager → Two-step verification. Without /register, inbound
//     events are routed to whichever app last claimed the number
//     (often the one that did Embedded Signup) — so a second user
//     adding a second number under the same WABA silently loses
//     every inbound message.
//
//   POST /{waba_id}/subscribed_apps
//     Subscribes the WABA itself to this app. Required exactly
//     once per WABA, but idempotent so calling on every save is
//     safe and cheap.
//
// Both calls are no-ops when already done — Meta returns success +
// the helpers below treat that as success.

export interface RegisterPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
  /**
   * 6-digit PIN the user set in Meta WhatsApp Manager →
   * Two-step verification. If 2FA is not enabled on the number,
   * Meta rejects /register with a clear error and the user is
   * pointed at the right setting in the UI.
   */
  pin: string
}

export interface RegisterPhoneNumberResult {
  success: boolean
  /**
   * True when Meta indicated the number was already registered to
   * THIS app — same outcome as a fresh registration from the
   * caller's POV, surfaced separately for logging clarity.
   */
  alreadyRegistered: boolean
}

/**
 * Register a phone number for inbound webhook events.
 *
 * Errors that should be surfaced verbatim to the user:
 *   * Missing / wrong PIN  → "Two-step verification PIN required..."
 *   * No 2FA enabled       → "Two-factor authentication is not on..."
 *   * Number on other app  → "Number is registered to another app..."
 */
export async function registerPhoneNumber(
  args: RegisterPhoneNumberArgs
): Promise<RegisterPhoneNumberResult> {
  const { phoneNumberId, accessToken, pin } = args
  const url = `${META_API_BASE}/${phoneNumberId}/register`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })

  if (response.ok) {
    return { success: true, alreadyRegistered: false }
  }

  // Meta returns an error envelope with a code. Code 133005 + the
  // text "already registered" appears when the number is already
  // subscribed to this app — that's success from the caller's
  // perspective, surface it as such.
  let data: MetaErrorResponse = {}
  try {
    data = await response.json()
  } catch {
    /* keep empty */
  }
  const message = data.error?.message ?? `Meta API error: ${response.status}`
  const code = data.error?.code
  // 133005 é o código canônico de "já registrado"; o teste por texto fica
  // como rede de segurança porque a Meta nem sempre manda o código nesse caso.
  if (code === 133005 || /already.*registered/i.test(message)) {
    return { success: true, alreadyRegistered: true }
  }
  throw new MetaApiError(message, {
    code,
    subcode: data.error?.error_subcode,
    httpStatus: response.status,
  })
}

/**
 * Códigos de erro do /register que significam "o PIN de verificação em duas
 * etapas está errado ou faltando".
 *
 * Importa porque a remediação é específica e não-óbvia: se o número JÁ teve um
 * PIN definido antes, só o PIN ANTIGO funciona — não adianta escolher um novo.
 * Sem o PIN antigo, o reset leva 7 dias ou passa pelo suporte da Meta. A UI
 * precisa dizer isso em vez de mostrar o erro cru da Meta.
 */
const PIN_ERROR_CODES = new Set([133007, 133008, 133009, 139000, 139001, 139003])

export function isPinError(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false
  if (err.code != null && PIN_ERROR_CODES.has(err.code)) return true
  return /two.?step|two.?factor|\bpin\b/i.test(err.message)
}

/**
 * 133010 — "Phone number not registered". Aparece no /register e no
 * /deregister quando o registro está solto no nível de messaging. A spec de
 * onboarding manda tratar como NÃO-REGISTRADO e seguir o caminho normal de
 * ativação, em vez de reportar como falha.
 */
export function isNotRegisteredError(err: unknown): boolean {
  return err instanceof MetaApiError && err.code === 133010
}

export interface SubscribeWabaToAppArgs {
  wabaId: string
  accessToken: string
}

/**
 * Subscribe the WABA to this Meta app's webhook. Idempotent — Meta
 * returns success even when the subscription already exists.
 */
export async function subscribeWabaToApp(
  args: SubscribeWabaToAppArgs
): Promise<void> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

export interface GetSubscribedAppsArgs {
  wabaId: string
  accessToken: string
}

export interface SubscribedApp {
  whatsapp_business_api_data?: {
    id?: string
    name?: string
    link?: string
  }
}

/**
 * Diagnostic — fetch the list of apps currently subscribed to this
 * WABA. The UI uses this to confirm OUR app is in the list when
 * the user clicks Verify Registration.
 */
export async function getSubscribedApps(
  args: GetSubscribedAppsArgs
): Promise<SubscribedApp[]> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: SubscribedApp[] }
  return data.data ?? []
}

// ============================================================
// Diagnóstico de onboarding
// ============================================================
//
// O cliente entrega "token + ID". Esse ID pode ser o Phone Number ID
// (o que a gente precisa) ou o WABA ID (o que ele copiou primeiro no
// painel da Meta). São objetos diferentes e o erro que a Graph devolve
// não diz qual é qual. As funções abaixo existem para descobrir isso
// sem chutar, antes de qualquer POST que mude estado.

export interface WabaPhoneNumber {
  id: string
  display_phone_number?: string
  verified_name?: string
  code_verification_status?: string
  platform_type?: string
  status?: string
}

/**
 * Lista os números de um WABA. É o teste do PASSO 1B: se o ID que o cliente
 * mandou responde aqui, ele era um WABA ID e o `id` de dentro de `data[]` é
 * o Phone Number ID de verdade.
 */
export async function listWabaPhoneNumbers(args: {
  wabaId: string
  accessToken: string
}): Promise<WabaPhoneNumber[]> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,platform_type,status`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: WabaPhoneNumber[] }
  return data.data ?? []
}

export interface DebugTokenInfo {
  is_valid: boolean
  scopes: string[]
  expires_at?: number
  app_id?: string
}

/**
 * Valida o token em si. Só é chamado quando o ID não resolve por nenhum
 * caminho — aí a pergunta deixa de ser "qual ID?" e passa a ser "esse token
 * serve?". Confere validade e os dois escopos obrigatórios.
 */
export async function debugToken(args: {
  accessToken: string
}): Promise<DebugTokenInfo> {
  const { accessToken } = args
  const url = `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(
    accessToken
  )}&access_token=${encodeURIComponent(accessToken)}`
  const response = await fetch(url)
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const body = (await response.json()) as {
    data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number; app_id?: string }
  }
  return {
    is_valid: body.data?.is_valid === true,
    scopes: body.data?.scopes ?? [],
    expires_at: body.data?.expires_at,
    app_id: body.data?.app_id,
  }
}

export const REQUIRED_TOKEN_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
] as const

export function missingTokenScopes(scopes: string[]): string[] {
  return REQUIRED_TOKEN_SCOPES.filter((s) => !scopes.includes(s))
}

export interface MetaBusiness {
  id: string
  name?: string
}

/** Negócios (BMs) que este token administra. */
export async function listBusinesses(args: {
  accessToken: string
}): Promise<MetaBusiness[]> {
  const url = `${META_API_BASE}/me/businesses?fields=id,name`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: MetaBusiness[] }
  return data.data ?? []
}

export interface OwnedWaba {
  id: string
  name?: string
}

/** WABAs pertencentes a um BM. */
export async function listOwnedWabas(args: {
  businessId: string
  accessToken: string
}): Promise<OwnedWaba[]> {
  const url = `${META_API_BASE}/${args.businessId}/owned_whatsapp_business_accounts?fields=id,name`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: OwnedWaba[] }
  return data.data ?? []
}

// ============================================================
// Re-verificação de número (CAMINHO B)
// ============================================================
//
// Quando code_verification_status = EXPIRED, a Meta exige provar de novo a
// posse da linha. O código chega por SMS ou ligação NO NÚMERO — não existe
// forma de a API pular essa etapa. Se ninguém controla o chip, o número não
// conecta, ponto.

export type CodeMethod = 'SMS' | 'VOICE'

/**
 * Pede o código de verificação. `VOICE` é a saída quando o SMS não chega
 * (comum em número fixo/portado ou operadora que bloqueia SMS A2P).
 */
export async function requestVerificationCode(args: {
  phoneNumberId: string
  accessToken: string
  codeMethod: CodeMethod
  language?: string
}): Promise<void> {
  const { phoneNumberId, accessToken, codeMethod, language = 'pt_BR' } = args
  const url = `${META_API_BASE}/${phoneNumberId}/request_code`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code_method: codeMethod, language }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

/** Confirma o código recebido no chip. Depois disso o número volta a VERIFIED. */
export async function verifyPhoneCode(args: {
  phoneNumberId: string
  accessToken: string
  code: string
}): Promise<void> {
  const { phoneNumberId, accessToken, code } = args
  const url = `${META_API_BASE}/${phoneNumberId}/verify_code`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  /** Meta's message_id of the message being replied to. Adds a `context` field
   *  so WhatsApp renders the new message as a reply with a quote preview. */
  contextMessageId?: string
}

/**
 * Send a free-form WhatsApp text message.
 * Only works inside the 24-hour customer service window.
 */
export async function sendTextMessage(
  args: SendTextMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, text, contextMessageId } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export type MediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendMediaMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  /** Optional caption — Meta caps at 1024 chars. Documents + images + videos accept it; audio does NOT. */
  caption?: string
  /** Document-only. Shown in the recipient's chat as the file name. Ignored for image/video/audio. */
  filename?: string
  contextMessageId?: string
}

/**
 * Send an image, video, document, or audio (voice note) via a public URL.
 *
 * Used by the Flows engine's `send_media` node and the inbox composer's
 * agent-initiated media sends. Mirrors `sendTextMessage` — single fetch,
 * throws on non-2xx, returns Meta's message id.
 *
 * Audio is special-cased: Meta rejects `caption` and `filename` on audio
 * messages, so we send `{ link }` only. WhatsApp auto-renders an
 * OGG/Opus file as a playable voice note (waveform) rather than a file
 * attachment.
 */
export async function sendMediaMessage(
  args: SendMediaMessageArgs,
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, kind, link, caption, filename, contextMessageId } = args
  if (!link) throw new Error('sendMediaMessage requires a link.')
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  // Audio accepts neither caption nor filename per Meta's spec — adding
  // either yields a 400. image/video/document accept a caption; only
  // document accepts a filename.
  const media: Record<string, unknown> = { link }
  if (caption && kind !== 'audio') media.caption = caption
  if (kind === 'document' && filename) media.filename = filename

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: kind,
    [kind]: media,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

import type { MessageTemplate } from '@/types'
import {
  buildSendComponents,
  type SendTimeParams,
} from './template-send-builder'

export interface SendTemplateMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  /**
   * Legacy body-only params. Kept for backward compat with callers
   * that haven't migrated to the structured `template` + `messageParams`
   * pair below. New callers should pass `template` so media headers
   * and URL buttons land on the send.
   */
  params?: string[]
  /**
   * The template row from message_templates. When provided, the helper
   * builds the full components array (header + body + buttons) via
   * buildSendComponents — that's the only way image/video/document
   * headers and URL-with-variable buttons actually reach the recipient.
   */
  template?: MessageTemplate
  /**
   * Structured per-send values. Body variables go in `body`; header
   * text variables in `headerText`; media overrides in
   * `headerMediaUrl` / `headerMediaId`; URL/COPY_CODE button values
   * in `buttonParams` keyed by index.
   */
  messageParams?: SendTimeParams
  /** Meta's message_id of the message being replied to. */
  contextMessageId?: string
}

/**
 * Send a pre-approved WhatsApp message template. Required outside
 * the 24-hour window and for any first-touch messaging.
 *
 * Caller paths:
 *   - Legacy: pass `params: string[]` (body only). Same behaviour as
 *     before this helper learned about media + buttons.
 *   - Structured: pass `template` (and optionally `messageParams`).
 *     The full components array is built from the row so media
 *     headers + URL buttons land correctly.
 */
export async function sendTemplateMessage(
  args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    templateName,
    language = 'en_US',
    params,
    template,
    messageParams,
    contextMessageId,
  } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const templatePayload: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  }

  if (template) {
    const components = buildSendComponents(template, {
      // Legacy callers pass body values in `params`; fold them into
      // `messageParams.body` so the new path covers them too.
      body: messageParams?.body ?? params,
      headerText: messageParams?.headerText,
      headerMediaUrl: messageParams?.headerMediaUrl,
      headerMediaId: messageParams?.headerMediaId,
      buttonParams: messageParams?.buttonParams,
    })
    if (components.length > 0) {
      templatePayload.components = components
    }
  } else if (params && params.length > 0) {
    // Legacy body-only path — no template row available.
    templatePayload.components = [
      {
        type: 'body',
        parameters: params.map((p) => ({ type: 'text', text: String(p) })),
      },
    ]
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: templatePayload,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Resumable Upload (media handles for template headers)
// ============================================================
//
// Creating a message template with a media HEADER (image/video/
// document) requires an `example.header_handle` — Meta does NOT accept
// a plain public URL at creation time. The handle comes from the
// two-step Resumable Upload API, which is keyed on the Meta APP id (not
// the phone number / WABA):
//
//   1. POST /{app_id}/uploads?file_name&file_length&file_type&access_token
//        → { id: "upload:<session>" }
//   2. POST /{id}  (Authorization: OAuth <token>, file_offset: 0, raw bytes)
//        → { h: "<handle>" }
//
// See https://developers.facebook.com/docs/graph-api/guides/upload

export interface UploadResumableMediaArgs {
  /** Meta App id (env META_APP_ID) — resumable upload is app-scoped. */
  appId: string
  accessToken: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

/**
 * Upload a file via the Resumable Upload API and return the media
 * handle to use as `example.header_handle` when creating/editing a
 * template with a media header.
 */
export async function uploadResumableMedia(
  args: UploadResumableMediaArgs,
): Promise<{ handle: string }> {
  const { appId, accessToken, fileName, mimeType, bytes } = args

  // Step 1 — open an upload session.
  const startParams = new URLSearchParams({
    file_name: fileName,
    file_length: String(bytes.byteLength),
    file_type: mimeType,
    access_token: accessToken,
  })
  const startRes = await fetch(
    `${META_API_BASE}/${appId}/uploads?${startParams.toString()}`,
    { method: 'POST' },
  )
  if (!startRes.ok) {
    await throwMetaError(startRes, `Resumable upload start failed: ${startRes.status}`)
  }
  const startData = (await startRes.json()) as { id?: string }
  if (!startData.id) {
    throw new Error('Resumable upload did not return a session id.')
  }

  // Step 2 — upload the bytes. Note the `OAuth` auth scheme (not Bearer)
  // and the file_offset header, both required by this endpoint.
  const uploadRes = await fetch(`${META_API_BASE}/${startData.id}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: '0',
    },
    // Uint8Array is a valid BodyInit at runtime; cast around the
    // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
    body: bytes as unknown as BodyInit,
  })
  if (!uploadRes.ok) {
    await throwMetaError(uploadRes, `Resumable upload failed: ${uploadRes.status}`)
  }
  const uploadData = (await uploadRes.json()) as { h?: string }
  if (!uploadData.h) {
    throw new Error('Resumable upload did not return a file handle.')
  }
  return { handle: uploadData.h }
}

// ============================================================
// Template submission (Business Management API)
// ============================================================

import type { MetaTemplateSubmitPayload } from './template-components'

export interface SubmitMessageTemplateArgs {
  wabaId: string
  accessToken: string
  payload: MetaTemplateSubmitPayload
}

export interface SubmitMessageTemplateResult {
  id: string
  status: string
  category?: string
}

/**
 * Submit a message template to Meta for approval.
 *
 * Returns Meta's assigned template id + initial status (typically
 * PENDING). Caller persists `id` as `meta_template_id` so the
 * upcoming edit/delete flows can scope to this exact template (and
 * language variant) via `hsm_id`, rather than nuking every variant
 * with the same name.
 *
 * 429s from Meta (rate limit: 100 creates/hour/WABA) surface as a
 * regular `Error('Meta API error: 429')`. The route handler
 * distinguishes 429 and shows a more actionable toast.
 */
export async function submitMessageTemplate(
  args: SubmitMessageTemplateArgs
): Promise<SubmitMessageTemplateResult> {
  const { wabaId, accessToken, payload } = args
  const url = `${META_API_BASE}/${wabaId}/message_templates`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  if (!data?.id) {
    throw new Error('Meta accepted the template but returned no id.')
  }
  return {
    id: String(data.id),
    status: typeof data.status === 'string' ? data.status : 'PENDING',
    category: typeof data.category === 'string' ? data.category : undefined,
  }
}

export interface EditMessageTemplateArgs {
  /** Meta's template id (stored locally as `meta_template_id`). */
  metaTemplateId: string
  accessToken: string
  /** Send the full components array — Meta replaces, not patches. */
  components: MetaTemplateSubmitPayload['components']
  /** Optional — only certain category transitions are allowed by Meta. */
  category?: MetaTemplateSubmitPayload['category']
}

export interface EditMessageTemplateResult {
  success: boolean
}

/**
 * Edit an existing (APPROVED or REJECTED) message template.
 *
 * Meta caps edits at 10 per 30 days (and 1 per 24h for APPROVED
 * templates). Every edit re-triggers review, so the status flips
 * back to PENDING until Meta approves the new components.
 *
 * Note: PENDING / DISABLED / IN_APPEAL templates cannot be edited
 * — the route handler enforces that before calling here.
 */
export async function editMessageTemplate(
  args: EditMessageTemplateArgs
): Promise<EditMessageTemplateResult> {
  const { metaTemplateId, accessToken, components, category } = args
  const body: Record<string, unknown> = { components }
  if (category) body.category = category
  const response = await fetch(`${META_API_BASE}/${metaTemplateId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json().catch(() => ({}))
  return { success: data?.success !== false }
}

export interface DeleteMessageTemplateArgs {
  wabaId: string
  accessToken: string
  name: string
  /**
   * Without `hsm_id`, Meta deletes EVERY language variant of the
   * template with this `name`. Pass the row's `meta_template_id`
   * to scope to a single variant.
   */
  metaTemplateId?: string
}

/**
 * Delete a message template on Meta. Pass `metaTemplateId` to scope
 * to a single language variant — otherwise Meta nukes every variant
 * sharing the same `name`.
 */
export async function deleteMessageTemplate(
  args: DeleteMessageTemplateArgs
): Promise<void> {
  const { wabaId, accessToken, name, metaTemplateId } = args
  const params = new URLSearchParams({ name })
  if (metaTemplateId) params.set('hsm_id', metaTemplateId)
  const url = `${META_API_BASE}/${wabaId}/message_templates?${params.toString()}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // Treat a 404 as a no-op — the template is already gone on Meta's
  // side, and we still want the local row removed.
  if (response.status === 404) return
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** Meta's message_id of the message being reacted to. */
  targetMessageId: string
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string
}

/**
 * Send a reaction (or removal) to a previously-exchanged message.
 * Empty `emoji` removes the reaction per Meta's spec.
 */
export async function sendReactionMessage(
  args: SendReactionMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, targetMessageId, emoji } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetMessageId, emoji },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Interactive (button replies + list messages)
// ============================================================
//
// Meta's two flavours of interactive message — used by the Flows
// engine to drive scripted chatbot menus. Caller passes plain
// JS values; helpers shape the Meta payload and enforce Meta's
// limits BEFORE the network call so the failure mode is a
// developer-facing error rather than a customer-facing one.

/**
 * Meta limits for interactive messages, hard-coded so violations
 * fail at build/save time rather than as a 400 from the Meta API
 * mid-conversation. See:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 */
export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const

export interface InteractiveButton {
  /** Stable id sent back in the webhook when tapped (≤ 256 chars). */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface SendInteractiveButtonsArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** The body text — what the customer reads above the buttons. */
  bodyText: string
  /** Optional plain-text header (≤ 60 chars). */
  headerText?: string
  /** Optional grey footer line under the buttons (≤ 60 chars). */
  footerText?: string
  /** 1–3 buttons. Validated against Meta's limits before sending. */
  buttons: InteractiveButton[]
  /** Meta's message_id of the message being replied to (quote preview). */
  contextMessageId?: string
}

/**
 * Send an interactive message with up to 3 inline reply buttons. The
 * customer taps one and Meta delivers a webhook with
 * `messages[0].interactive.button_reply.id` set to the matching button.id.
 *
 * Validation throws BEFORE the network call so misconfigured flows
 * fail at save time, not during a live conversation.
 */
export async function sendInteractiveButtons(
  args: SendInteractiveButtonsArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, headerText, footerText, buttons, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (buttons.length < 1 || buttons.length > INTERACTIVE_LIMITS.maxButtons) {
    throw new Error(
      `Interactive button message requires 1-${INTERACTIVE_LIMITS.maxButtons} buttons (got ${buttons.length}).`
    )
  }
  for (const btn of buttons) {
    if (!btn.id) throw new Error('Interactive button missing id.')
    if (!btn.title) throw new Error(`Interactive button "${btn.id}" missing title.`)
    if (btn.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      throw new Error(
        `Interactive button title "${btn.title}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
      )
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title },
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface InteractiveListRow {
  /** Stable id sent back in the webhook when tapped (≤ 200 chars). */
  id: string
  /** Visible row title (≤ 24 chars per Meta). */
  title: string
  /** Optional secondary line shown under the title (≤ 72 chars). */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}

export interface SendInteractiveListArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  /** Label of the tap-to-expand button on the message bubble. */
  buttonLabel: string
  headerText?: string
  footerText?: string
  /**
   * 1–10 rows TOTAL across all sections. Meta caps the *total*, not
   * per-section. Validation enforces this before send.
   */
  sections: InteractiveListSection[]
  contextMessageId?: string
}

/**
 * Send an interactive message with a tap-to-expand list of selectable
 * rows. Use when there are more options than the 3-button limit allows.
 * Webhook arrives with `messages[0].interactive.list_reply.id` set to
 * the matching row.id.
 */
export async function sendInteractiveList(
  args: SendInteractiveListArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, buttonLabel, headerText, footerText, sections, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (!buttonLabel) throw new Error('Interactive list requires a buttonLabel.')
  if (buttonLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `Interactive list buttonLabel "${buttonLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
    )
  }
  if (sections.length < 1 || sections.length > INTERACTIVE_LIMITS.maxListSections) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListSections} sections (got ${sections.length}).`
    )
  }
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0)
  if (totalRows < 1 || totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across all sections (got ${totalRows}).`
    )
  }
  const seenIds = new Set<string>()
  for (const section of sections) {
    for (const row of section.rows) {
      if (!row.id) throw new Error('Interactive list row missing id.')
      if (seenIds.has(row.id)) {
        throw new Error(`Interactive list has duplicate row id "${row.id}".`)
      }
      seenIds.add(row.id)
      if (!row.title) throw new Error(`Interactive list row "${row.id}" missing title.`)
      if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
        throw new Error(
          `Interactive list row title "${row.title}" exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`
        )
      }
      if (
        row.description &&
        row.description.length > INTERACTIVE_LIMITS.listRowDescriptionMaxLength
      ) {
        throw new Error(
          `Interactive list row description for "${row.id}" exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`
        )
      }
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: buttonLabel,
      sections: sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

function validateInteractiveBody(bodyText: string): void {
  if (!bodyText) throw new Error('Interactive message requires bodyText.')
  if (bodyText.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Interactive bodyText exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars.`
    )
  }
}

function validateInteractiveHeaderFooter(
  headerText: string | undefined,
  footerText: string | undefined,
): void {
  if (headerText && headerText.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
    throw new Error(
      `Interactive headerText exceeds ${INTERACTIVE_LIMITS.headerTextMaxLength} chars.`
    )
  }
  if (footerText && footerText.length > INTERACTIVE_LIMITS.footerMaxLength) {
    throw new Error(
      `Interactive footerText exceeds ${INTERACTIVE_LIMITS.footerMaxLength} chars.`
    )
  }
}

// ============================================================
// Media
// ============================================================

export interface GetMediaUrlArgs {
  mediaId: string
  accessToken: string
}

/**
 * Resolve a media ID to Meta's (short-lived, authenticated) CDN URL
 * plus the MIME type. Step one of the media-proxy flow.
 */
export async function getMediaUrl(
  args: GetMediaUrlArgs
): Promise<{ url: string; mimeType: string }> {
  const { mediaId, accessToken } = args
  const response = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Media fetch failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.url) throw new Error('Media URL not found in Meta response')
  return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' }
}

export interface DownloadMediaArgs {
  downloadUrl: string
  accessToken: string
}

/**
 * Fetch the binary bytes for a media URL obtained from getMediaUrl.
 * Step two of the media-proxy flow.
 */
export async function downloadMedia(
  args: DownloadMediaArgs
): Promise<{ buffer: Buffer; contentType: string }> {
  const { downloadUrl, accessToken } = args
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status}`)
  }
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}
