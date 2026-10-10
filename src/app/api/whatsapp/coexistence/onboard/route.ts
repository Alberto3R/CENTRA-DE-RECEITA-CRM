import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  MetaApiError,
  exchangeEmbeddedSignupCode,
  requestSmbAppDataSync,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'

/**
 * POST /api/whatsapp/coexistence/onboard
 *
 * Fecha a conexão de um número do app WhatsApp Business (Coexistência) depois
 * que o Embedded Signup termina no navegador:
 *
 *   1. troca o `code` (vale ~30s) por token;
 *   2. lê o número na Meta e assina a WABA no app (webhook);
 *   3. grava o canal (connection_mode='coexistence') — SEM /register: o
 *      número já está registrado pelo próprio app do celular;
 *   4. pede a sincronização da agenda e do histórico (180 dias). A Meta só
 *      aceita isso uma vez e até 24h depois da conexão.
 *
 * Body: { code, phone_number_id, waba_id, label? }
 * Env: NEXT_PUBLIC_META_APP_ID + META_EMBEDDED_SIGNUP_APP_SECRET (o app da
 * Meta configurado como Tech Provider, dono do Embedded Signup).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

function metaMessage(err: unknown): string {
  if (err instanceof MetaApiError) return err.message
  return err instanceof Error ? err.message : 'Erro desconhecido na Meta'
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_EMBEDDED_SIGNUP_APP_SECRET
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: 'Conexão pelo app ainda não configurada no servidor (app da Meta).' },
      { status: 503 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    code?: string
    phone_number_id?: string
    waba_id?: string
    label?: string
  } | null
  const code = body?.code?.trim()
  const phoneNumberId = body?.phone_number_id?.trim()
  const wabaId = body?.waba_id?.trim()
  const label = body?.label?.trim() || null
  if (!code || !phoneNumberId || !wabaId) {
    return NextResponse.json(
      { error: 'Faltou o código, o número ou a conta do WhatsApp vindos da Meta.' },
      { status: 400 },
    )
  }

  // 1. code → token
  let accessToken: string
  try {
    accessToken = await exchangeEmbeddedSignupCode({ code, appId, appSecret })
  } catch (err) {
    return NextResponse.json(
      { error: `A Meta recusou o código da conexão: ${metaMessage(err)}` },
      { status: 502 },
    )
  }

  // 2. número + webhook
  let displayPhone: string | null = null
  try {
    const info = await verifyPhoneNumber({ phoneNumberId, accessToken })
    displayPhone = info.display_phone_number ?? null
    await subscribeWabaToApp({ wabaId, accessToken })
  } catch (err) {
    return NextResponse.json(
      { error: `Não consegui ler o número ou assinar o webhook na Meta: ${metaMessage(err)}` },
      { status: 502 },
    )
  }

  // Um número só pode estar em UMA conta desta instância.
  const { data: claimed, error: claimErr } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id')
    .eq('phone_number_id', phoneNumberId)
  if (claimErr) {
    return NextResponse.json({ error: 'Falha ao validar o número.' }, { status: 500 })
  }
  const rows = (claimed ?? []) as { id: string; account_id: string }[]
  if (rows.some((r) => r.account_id !== ctx.accountId)) {
    return NextResponse.json(
      { error: 'Este número já está ligado a outra conta do CRM.' },
      { status: 409 },
    )
  }
  const existing = rows[0] ?? null

  // 3. grava o canal
  const now = new Date().toISOString()
  const baseRow = {
    phone_number_id: phoneNumberId,
    waba_id: wabaId,
    display_phone_number: displayPhone,
    access_token: encrypt(accessToken),
    // HMAC do webhook: os eventos deste número vêm assinados por ESTE app.
    app_secret: encrypt(appSecret),
    channel_type: 'whatsapp',
    connection_mode: 'coexistence',
    status: 'connected',
    connected_at: now,
    registered_at: now,
    subscribed_apps_at: now,
    coex_onboarded_at: now,
    coex_last_error: null,
    updated_at: now,
  }

  let channelId: string
  if (existing) {
    const { error } = await ctx.supabase
      .from('whatsapp_config')
      .update(label ? { ...baseRow, label } : baseRow)
      .eq('id', existing.id)
    if (error) {
      console.error('[coex/onboard] update falhou:', error)
      return NextResponse.json({ error: 'Falha ao salvar o canal.' }, { status: 500 })
    }
    channelId = existing.id
  } else {
    const { count } = await ctx.supabase
      .from('whatsapp_config')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
    const isFirst = (count ?? 0) === 0
    const { data, error } = await ctx.supabase
      .from('whatsapp_config')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        is_primary: isFirst,
        label: label ?? displayPhone ?? 'WhatsApp do celular',
        ...baseRow,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[coex/onboard] insert falhou:', error)
      return NextResponse.json({ error: 'Falha ao salvar o canal.' }, { status: 500 })
    }
    channelId = (data as { id: string }).id
  }

  // 4. agenda primeiro (dá nome às conversas), histórico depois.
  const sync: { contacts: boolean; history: boolean; error: string | null } = {
    contacts: false,
    history: false,
    error: null,
  }
  try {
    await requestSmbAppDataSync({ phoneNumberId, accessToken, syncType: 'smb_app_state_sync' })
    sync.contacts = true
    await requestSmbAppDataSync({ phoneNumberId, accessToken, syncType: 'history' })
    sync.history = true
  } catch (err) {
    sync.error = metaMessage(err)
    console.error('[coex/onboard] sincronização falhou:', sync.error)
  }

  await supabaseAdmin()
    .from('whatsapp_config')
    .update({
      ...(sync.contacts ? { coex_contacts_sync_requested_at: new Date().toISOString() } : {}),
      ...(sync.history ? { coex_history_sync_requested_at: new Date().toISOString() } : {}),
      coex_last_error: sync.error,
    })
    .eq('id', channelId)

  return NextResponse.json({
    success: true,
    channel_id: channelId,
    display_phone_number: displayPhone,
    sync,
  })
}
