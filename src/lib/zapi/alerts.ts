/**
 * Aviso de queda do WhatsApp conectado por QR code (migration 121).
 *
 * Quando a sessão da Z-API cai, ninguém percebe: a loja para de receber e o
 * vendedor "envia" mensagens que ficam paradas na fila da Z-API. Aqui:
 *
 *   registrarQueda    marca o canal desconectado e, se é uma queda NOVA
 *                     (estava conectado e ainda não avisamos), espera um pouco,
 *                     confere na Z-API se não voltou sozinho e avisa
 *   registrarConexao  marca conectado e, se tinha avisado a queda, avisa que voltou
 *
 * Quem é avisado: `alert_phone` do canal no WhatsApp — pelo número OFICIAL da
 * Sales 3R, porque o número que caiu não manda nada — e `alert_email` (ou o
 * dono da conta) por e-mail, com cópia para a 3R (`app_config.alert_email_to`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { getStatus, zapiCredsFromChannel } from './client'

/** Modelo Utility aprovado no número da 3R: corpo com um único {{1}} livre. */
const MODELO_PADRAO = 'ccc_alerta_gestor'
const LINK_RECONECTAR = 'https://www.centraldereceita.com.br/settings?tab=whatsapp'
/** A Z-API às vezes cai e volta sozinha em segundos (reinício da instância). */
const ESPERA_PADRAO_MS = 30_000
/** Motivo gravado quando alguém desconecta pela própria Central — não é queda. */
export const DESCONEXAO_MANUAL = 'Desconectado manualmente na Central'

interface CanalAlerta {
  id: string
  account_id: string
  label: string | null
  display_phone_number: string | null
  status: string | null
  alert_phone: string | null
  alert_email: string | null
  qr_alerted_at: string | null
  qr_last_error: string | null
  qr_instance_id: string | null
  access_token: string | null
  qr_client_token: string | null
}

const CAMPOS =
  'id, account_id, label, display_phone_number, status, alert_phone, alert_email, qr_alerted_at, qr_last_error, qr_instance_id, access_token, qr_client_token'

// ── Textos (puros) ───────────────────────────────────────────────────────

function nomeDoCanal(c: Pick<CanalAlerta, 'label' | 'display_phone_number'>): string {
  const label = c.label?.trim() || 'WhatsApp'
  return c.display_phone_number ? `${label} (${c.display_phone_number})` : label
}

export function horaBrasilia(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Texto do {{1}} do modelo. A Meta recusa variável com quebra de linha, tab
 * ou mais de 4 espaços seguidos — por isso uma linha só.
 */
export function textoQueda(args: {
  conta: string
  canal: Pick<CanalAlerta, 'label' | 'display_phone_number'>
  quando: Date
}): string {
  return (
    `⚠️ O WhatsApp ${nomeDoCanal(args.canal)} da ${args.conta} desconectou da Central de Receita ` +
    `em ${horaBrasilia(args.quando)}. Até reconectar, nenhuma mensagem entra nem sai pela Central. ` +
    `Para reconectar: Configurações → WhatsApp e escaneie o QR code com o celular da loja.`
  )
}

export function textoVolta(args: {
  conta: string
  canal: Pick<CanalAlerta, 'label' | 'display_phone_number'>
}): string {
  return `✅ O WhatsApp ${nomeDoCanal(args.canal)} da ${args.conta} voltou a funcionar na Central de Receita.`
}

export function textoTeste(args: {
  conta: string
  canal: Pick<CanalAlerta, 'label' | 'display_phone_number'>
}): string {
  return (
    `Teste do aviso de queda: se o WhatsApp ${nomeDoCanal(args.canal)} da ${args.conta} ` +
    `desconectar da Central de Receita, é por aqui que você fica sabendo.`
  )
}

/** Telefone do responsável → formato da Meta. BR sem DDI ganha o 55. */
export function telefoneDoResponsavel(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return null
  const comDdi = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits
  const phone = sanitizePhoneForMeta(comDdi)
  return isValidE164(phone) ? phone : null
}

// ── Envio ────────────────────────────────────────────────────────────────

async function appConfig(db: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await db.from('app_config').select('value').eq('key', key).maybeSingle()
  return ((data as { value?: string } | null)?.value ?? null) || null
}

/**
 * Número que manda o aviso: `app_config.alert_whatsapp_channel_id` ou, sem
 * isso, o canal da API oficial (conectado) que tem o modelo aprovado.
 */
async function canalRemetente(
  db: SupabaseClient,
  modelo: string,
): Promise<{ phoneNumberId: string; accessToken: string } | null> {
  let channelId = await appConfig(db, 'alert_whatsapp_channel_id')
  if (!channelId) {
    const { data } = await db
      .from('message_templates')
      .select('channel_id')
      .eq('name', modelo)
      .eq('status', 'APPROVED')
      .limit(1)
      .maybeSingle()
    channelId = (data as { channel_id?: string } | null)?.channel_id ?? null
  }
  if (!channelId) return null
  const { data: ch } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token, status')
    .eq('id', channelId)
    .maybeSingle()
  const row = ch as { phone_number_id?: string | null; access_token?: string | null } | null
  if (!row?.phone_number_id || !row.access_token) return null
  try {
    return { phoneNumberId: row.phone_number_id, accessToken: decrypt(row.access_token) }
  } catch {
    return null
  }
}

async function enviarWhatsApp(db: SupabaseClient, para: string, texto: string): Promise<boolean> {
  const modelo = (await appConfig(db, 'alert_whatsapp_template')) ?? MODELO_PADRAO
  const remetente = await canalRemetente(db, modelo)
  if (!remetente) {
    console.warn('[alerta-qr] sem número remetente para o aviso')
    return false
  }
  try {
    await sendTemplateMessage({
      ...remetente,
      to: para,
      templateName: modelo,
      language: 'pt_BR',
      params: [texto],
    })
    return true
  } catch (err) {
    console.error('[alerta-qr] WhatsApp do aviso falhou:', err instanceof Error ? err.message : err)
    return false
  }
}

async function emailDoDono(db: SupabaseClient, accountId: string): Promise<string | null> {
  try {
    const { data } = await db.from('accounts').select('owner_user_id').eq('id', accountId).maybeSingle()
    const owner = (data as { owner_user_id?: string } | null)?.owner_user_id
    if (!owner) return null
    const { data: u } = await db.auth.admin.getUserById(owner)
    return u?.user?.email ?? null
  } catch {
    return null
  }
}

async function enviarEmail(
  db: SupabaseClient,
  args: { para: string[]; assunto: string; texto: string },
): Promise<boolean> {
  const key = await appConfig(db, 'alert_resend_api_key')
  const para = [...new Set(args.para.filter(Boolean))]
  if (!key || para.length === 0) return false
  const html =
    `<div style="font-family:Arial;font-size:15px;color:#1a1a1a;max-width:600px">` +
    `<p>${args.texto}</p>` +
    `<p><a href="${LINK_RECONECTAR}">Abrir Configurações → WhatsApp</a></p>` +
    `<p style="color:#888;font-size:12px">Aviso automático da Central de Receita.</p></div>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Central de Receita <updates@updates.augra.com.br>',
        to: para,
        subject: args.assunto,
        html,
      }),
    })
    if (!res.ok) console.error('[alerta-qr] e-mail do aviso falhou:', res.status, await res.text())
    return res.ok
  } catch (err) {
    console.error('[alerta-qr] e-mail do aviso falhou:', err)
    return false
  }
}

async function nomeDaConta(db: SupabaseClient, accountId: string): Promise<string> {
  const { data } = await db.from('accounts').select('name').eq('id', accountId).maybeSingle()
  return (data as { name?: string } | null)?.name || 'sua empresa'
}

async function carregar(db: SupabaseClient, channelId: string): Promise<CanalAlerta | null> {
  const { data } = await db.from('whatsapp_config').select(CAMPOS).eq('id', channelId).maybeSingle()
  return (data as CanalAlerta | null) ?? null
}

/** Manda o aviso (WhatsApp + e-mail). Devolve o que saiu. */
export async function avisar(
  db: SupabaseClient,
  canal: CanalAlerta,
  tipo: 'queda' | 'volta' | 'teste',
  quando = new Date(),
): Promise<{ whatsapp: boolean; email: boolean }> {
  const conta = await nomeDaConta(db, canal.account_id)
  const texto =
    tipo === 'queda'
      ? textoQueda({ conta, canal, quando })
      : tipo === 'volta'
        ? textoVolta({ conta, canal })
        : textoTeste({ conta, canal })
  const assunto =
    tipo === 'queda'
      ? `⚠️ WhatsApp desconectado: ${canal.label || 'WhatsApp'} · ${conta}`
      : tipo === 'volta'
        ? `✅ WhatsApp reconectado: ${canal.label || 'WhatsApp'} · ${conta}`
        : `Teste do aviso de queda · ${conta}`

  const fone = telefoneDoResponsavel(canal.alert_phone)
  const whatsapp = fone ? await enviarWhatsApp(db, fone, texto) : false

  const responsavel = canal.alert_email?.trim() || (await emailDoDono(db, canal.account_id))
  // Teste vai só para o responsável; queda e volta, com cópia para a 3R.
  const copia = tipo === 'teste' ? null : await appConfig(db, 'alert_email_to')
  const email = await enviarEmail(db, {
    para: [responsavel ?? '', copia ?? ''],
    assunto,
    texto,
  })
  return { whatsapp, email }
}

// ── Eventos da Z-API ─────────────────────────────────────────────────────

/**
 * DisconnectedCallback. Marca o canal; se é queda nova, espera, confere e avisa.
 * Roda dentro do after() do webhook.
 */
export async function registrarQueda(
  db: SupabaseClient,
  channelId: string,
  motivo: string | null,
  opts: { esperaMs?: number } = {},
): Promise<'avisado' | 'ja_avisado' | 'voltou_sozinho' | 'sem_canal'> {
  const antes = await carregar(db, channelId)
  if (!antes) return 'sem_canal'

  const quando = new Date()
  // Mesma queda reportada de novo (a Z-API repete o evento ao tentar voltar),
  // ou desconexão feita pela Central: só garante o status, sem novo aviso e
  // sem trocar o motivo já gravado.
  if (antes.qr_alerted_at) {
    await db
      .from('whatsapp_config')
      .update({ status: 'disconnected', updated_at: quando.toISOString() })
      .eq('id', channelId)
    return 'ja_avisado'
  }
  await db
    .from('whatsapp_config')
    .update({
      status: 'disconnected',
      qr_last_error: motivo || 'Sessão do WhatsApp desconectada',
      updated_at: quando.toISOString(),
    })
    .eq('id', channelId)

  const espera =
    opts.esperaMs ?? Number(process.env.QR_ALERTA_ESPERA_MS ?? ESPERA_PADRAO_MS)
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))

  // Voltou sozinho? (reinício da instância derruba e reconecta em segundos)
  try {
    const st = await getStatus(zapiCredsFromChannel(antes))
    if (st.connected) return 'voltou_sozinho'
  } catch {
    // Z-API fora do ar também é queda — segue para o aviso.
  }
  const atual = await carregar(db, channelId)
  if (!atual || atual.status === 'connected' || atual.qr_alerted_at) return 'voltou_sozinho'

  await avisar(db, atual, 'queda', quando)
  await db
    .from('whatsapp_config')
    .update({ qr_alerted_at: new Date().toISOString() })
    .eq('id', channelId)
  return 'avisado'
}

/** ConnectedCallback. Marca conectado e, se a queda foi avisada, avisa a volta. */
export async function registrarConexao(
  db: SupabaseClient,
  channelId: string,
  displayPhone: string | null,
): Promise<void> {
  const antes = await carregar(db, channelId)
  const now = new Date().toISOString()
  await db
    .from('whatsapp_config')
    .update({
      status: 'connected',
      connected_at: now,
      ...(displayPhone ? { display_phone_number: displayPhone } : {}),
      qr_last_error: null,
      qr_alerted_at: null,
      updated_at: now,
    })
    .eq('id', channelId)
  // "Voltou" só faz sentido se avisamos a queda — não depois de alguém
  // desconectar de propósito pela Central.
  const foiManual = (antes?.qr_last_error ?? '').startsWith(DESCONEXAO_MANUAL)
  if (antes?.qr_alerted_at && !foiManual) {
    await avisar(db, { ...antes, display_phone_number: displayPhone ?? antes.display_phone_number }, 'volta')
  }
}

/** Botão "Mandar aviso de teste" da tela do canal. */
export async function avisoDeTeste(
  db: SupabaseClient,
  channelId: string,
): Promise<{ whatsapp: boolean; email: boolean } | null> {
  const canal = await carregar(db, channelId)
  if (!canal) return null
  return avisar(db, canal, 'teste')
}
