import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  disconnect,
  getPhoneCode,
  getQrImage,
  getStatus,
  zapiCredsFromChannel,
} from '@/lib/zapi/client'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

/**
 * /api/whatsapp/qr/{channelId} — conexão do WhatsApp por QR code (Z-API).
 *
 * GET   estado da sessão; se não estiver conectada, devolve o QR (data URL,
 *       troca a cada ~20 s — a tela pede de novo).
 * POST  { action: 'phone-code', phone }  código para digitar no celular
 *       { action: 'disconnect' }         derruba a sessão
 *
 * Só admin da conta. As credenciais da Z-API nunca saem do servidor.
 */

interface QrChannel {
  id: string
  account_id: string
  qr_instance_id: string | null
  access_token: string | null
  qr_client_token: string | null
  status: string | null
  display_phone_number: string | null
  qr_last_error: string | null
}

async function loadChannel(accountId: string, channelId: string): Promise<QrChannel | null> {
  const { data } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, qr_instance_id, access_token, qr_client_token, status, display_phone_number, qr_last_error')
    .eq('id', channelId)
    .eq('account_id', accountId)
    .eq('connection_mode', 'qr')
    .maybeSingle()
  return (data as QrChannel | null) ?? null
}

function zapiErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : 'Erro desconhecido na Z-API'
  return NextResponse.json({ error: `Z-API: ${message}` }, { status: 502 })
}

async function setStatus(channelId: string, connected: boolean) {
  const now = new Date().toISOString()
  await supabaseAdmin()
    .from('whatsapp_config')
    .update({
      status: connected ? 'connected' : 'disconnected',
      ...(connected ? { connected_at: now, qr_last_error: null } : {}),
      updated_at: now,
    })
    .eq('id', channelId)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { channelId } = await params
  const channel = await loadChannel(ctx.accountId, channelId)
  if (!channel) {
    return NextResponse.json({ error: 'Canal de QR code não encontrado.' }, { status: 404 })
  }

  try {
    const creds = zapiCredsFromChannel(channel)
    const status = await getStatus(creds)
    // Mantém o banco em dia mesmo se um webhook de conectar/desconectar se perdeu.
    if (status.connected !== (channel.status === 'connected')) {
      await setStatus(channel.id, status.connected)
    }
    if (status.connected) {
      return NextResponse.json({
        connected: true,
        phone: channel.display_phone_number,
        smartphoneConnected: status.smartphoneConnected ?? null,
      })
    }
    const qr = await getQrImage(creds)
    return NextResponse.json({
      connected: false,
      qr: qr.image,
      challenge: qr.challenge,
      lastError: channel.qr_last_error,
    })
  } catch (err) {
    return zapiErrorResponse(err)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { channelId } = await params
  const channel = await loadChannel(ctx.accountId, channelId)
  if (!channel) {
    return NextResponse.json({ error: 'Canal de QR code não encontrado.' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as {
    action?: string
    phone?: string
  } | null

  try {
    const creds = zapiCredsFromChannel(channel)

    if (body?.action === 'phone-code') {
      const phone = normalizePhone(body.phone ?? '')
      if (phone.length < 12) {
        return NextResponse.json(
          { error: 'Informe o número com DDI e DDD, ex.: 55 31 99999-9999.' },
          { status: 400 },
        )
      }
      const r = await getPhoneCode(creds, phone)
      return NextResponse.json({ code: r.code, challenge: r.challenge })
    }

    if (body?.action === 'disconnect') {
      await disconnect(creds)
      await setStatus(channel.id, false)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 })
  } catch (err) {
    return zapiErrorResponse(err)
  }
}
