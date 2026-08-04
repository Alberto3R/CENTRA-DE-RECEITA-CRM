import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneCode, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { isLive, registerWithPin } from '@/lib/whatsapp/activation'
import { loadChannelForActivation } from '../channel-context'

/**
 * POST /api/whatsapp/config/verify-code
 *
 * CAMINHO B, passos 2 e 3 — confirma o código recebido no chip e, na sequência,
 * registra o número.
 *
 * Os dois passos ficam na mesma rota de propósito: depois do verify_code o
 * número volta a VERIFIED e o que falta é exatamente o /register do CAMINHO A.
 * Separar em duas chamadas só criaria um estado intermediário em que o cliente
 * verificou mas continua desconectado, sem nada na UI explicando por quê.
 *
 * Body: { channelId?: string, code: string, pin?: string }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const channelId = typeof body.channelId === 'string' ? body.channelId : null
    const code =
      typeof body.code === 'string' ? body.code.replace(/\D/g, '') : ''
    const pin = typeof body.pin === 'string' ? body.pin.trim() : ''

    if (!code) {
      return NextResponse.json(
        { error: 'Informe o código de verificação recebido no número.' },
        { status: 400 },
      )
    }
    if (pin && !/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'O PIN deve ter exatamente 6 dígitos.' },
        { status: 400 },
      )
    }

    const ctx = await loadChannelForActivation(supabase, user.id, channelId)
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status })
    }

    let accessToken: string
    try {
      accessToken = decrypt(ctx.config.access_token)
    } catch {
      return NextResponse.json(
        {
          error:
            'O token salvo não pôde ser descriptografado (ENCRYPTION_KEY mudou). Re-salve as credenciais do canal antes de continuar.',
        },
        { status: 400 },
      )
    }

    // Passo B2 — confirma a posse da linha.
    try {
      await verifyPhoneCode({
        phoneNumberId: ctx.config.phone_number_id,
        accessToken,
        code,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[whatsapp/verify-code] código recusado:', message)
      return NextResponse.json({ error: message, verified: false }, { status: 400 })
    }

    // PIN para o registro: o informado agora, senão o já salvo.
    let effectivePin = pin || null
    if (!effectivePin && ctx.config.pin_encrypted) {
      try {
        effectivePin = decrypt(ctx.config.pin_encrypted)
      } catch {
        effectivePin = null
      }
    }
    if (!effectivePin) {
      // Verificado, mas sem PIN não dá para registrar. Persistimos o avanço
      // (o número saiu de EXPIRED) para o cliente não ter que refazer o
      // código, que é a parte cara do fluxo.
      await supabaseAdmin()
        .from('whatsapp_config')
        .update({
          code_verification_status: 'VERIFIED',
          last_diagnosis_at: new Date().toISOString(),
        })
        .eq('id', ctx.config.id)
      return NextResponse.json({
        verified: true,
        success: false,
        outcome: 'needs_pin',
        message:
          'Número verificado. Agora informe o PIN de verificação em duas etapas (6 dígitos) para concluir a ativação.',
      })
    }

    // Passo B3 — registra, reusando o mesmo tratamento de erro do CAMINHO A.
    const info = await verifyPhoneNumber({
      phoneNumberId: ctx.config.phone_number_id,
      accessToken,
    })
    const result = await registerWithPin(
      {
        phoneNumberId: ctx.config.phone_number_id,
        info,
        codeVerificationStatus: info.code_verification_status ?? 'VERIFIED',
        platformType: info.platform_type ?? '',
        status: info.status ?? '',
      },
      accessToken,
      effectivePin,
    )

    const live = isLive(result)
    const agora = new Date().toISOString()
    const { error: updateError } = await supabaseAdmin()
      .from('whatsapp_config')
      .update({
        status: live ? 'connected' : 'disconnected',
        connected_at: live ? agora : null,
        registered_at: live ? agora : ctx.config.registered_at,
        code_verification_status: info.code_verification_status ?? 'VERIFIED',
        platform_type: info.platform_type ?? null,
        last_diagnosis_at: agora,
        last_registration_error:
          result.outcome === 'meta_error' || result.outcome === 'needs_old_pin'
            ? result.message
            : null,
        updated_at: agora,
        // Só grava o PIN quando veio um novo nesta chamada.
        ...(pin ? { pin_encrypted: encrypt(pin) } : {}),
      })
      .eq('id', ctx.config.id)

    if (updateError) {
      console.error('[whatsapp/verify-code] falha ao persistir:', updateError)
      return NextResponse.json(
        { error: 'Número ativado na Meta, mas houve falha ao salvar o estado local.' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      verified: true,
      success: live,
      activation: result,
      phone_info: info,
    })
  } catch (error) {
    console.error('Error in verify-code POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
