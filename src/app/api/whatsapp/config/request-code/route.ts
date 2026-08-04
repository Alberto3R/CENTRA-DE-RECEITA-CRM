import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { requestVerificationCode, type CodeMethod } from '@/lib/whatsapp/meta-api'
import { loadChannelForActivation } from '../channel-context'

/**
 * POST /api/whatsapp/config/request-code
 *
 * CAMINHO B, passo 1 — pede à Meta que envie o código de re-verificação.
 *
 * Só é necessário quando o número está com code_verification_status =
 * EXPIRED. O código chega POR SMS OU LIGAÇÃO NO PRÓPRIO NÚMERO: não existe
 * jeito de a API pular essa etapa. Se ninguém tem acesso à linha, o número
 * não volta — é o único ponto do onboarding que depende do cliente.
 *
 * Body: { channelId?: string, code_method?: 'SMS' | 'VOICE', language?: string }
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
    const codeMethod: CodeMethod = body.code_method === 'VOICE' ? 'VOICE' : 'SMS'
    const language =
      typeof body.language === 'string' && body.language.trim()
        ? body.language.trim()
        : 'pt_BR'

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

    try {
      await requestVerificationCode({
        phoneNumberId: ctx.config.phone_number_id,
        accessToken,
        codeMethod,
        language,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[whatsapp/request-code] Meta recusou:', message)
      return NextResponse.json(
        {
          error: message,
          // SMS falha com frequência em linha portada, fixo ou operadora que
          // bloqueia SMS A2P. A ligação costuma passar — vale sugerir antes
          // que o cliente conclua que o número é irrecuperável.
          hint:
            codeMethod === 'SMS'
              ? 'Se o SMS não chegar, tente de novo escolhendo a opção por ligação (VOICE).'
              : undefined,
        },
        { status: 400 },
      )
    }

    return NextResponse.json({
      success: true,
      code_method: codeMethod,
      message:
        codeMethod === 'VOICE'
          ? 'A Meta vai ligar para o número e ditar o código. Atenda e informe o código recebido.'
          : 'A Meta enviou um SMS com o código para o número. Informe o código recebido.',
    })
  } catch (error) {
    console.error('Error in request-code POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
