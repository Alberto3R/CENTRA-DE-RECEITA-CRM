import type { createClient } from '@/lib/supabase/server'

/**
 * Carrega o canal de WhatsApp alvo das rotas de ativação, já com a conta do
 * usuário resolvida.
 *
 * Compartilhado por request-code e verify-code porque as duas precisam
 * exatamente do mesmo preâmbulo — e porque duplicá-lo é como o `.maybeSingle()`
 * por conta virou bug quando a conta passou a ter mais de um canal.
 */
export interface ActivationChannel {
  id: string
  phone_number_id: string
  waba_id: string | null
  access_token: string
  pin_encrypted: string | null
  registered_at: string | null
  code_verification_status: string | null
}

export async function loadChannelForActivation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  channelId: string | null,
): Promise<{ config: ActivationChannel; accountId: string } | { error: string; status: number }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return { error: 'Seu perfil não está vinculado a uma conta.', status: 403 }
  }

  const cols =
    'id, phone_number_id, waba_id, access_token, pin_encrypted, registered_at, code_verification_status'
  let query = supabase
    .from('whatsapp_config')
    .select(cols)
    .eq('account_id', accountId)
    .eq('channel_type', 'whatsapp')
  // Sem channelId explícito, opera no canal primário — mesma convenção do
  // resto das rotas de configuração.
  query = channelId ? query.eq('id', channelId) : query.eq('is_primary', true)

  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[activation] falha ao carregar canal:', error)
    return { error: 'Falha ao carregar a configuração do canal.', status: 500 }
  }
  if (!data) {
    return {
      error:
        'Nenhum canal de WhatsApp encontrado. Salve as credenciais do número antes de verificá-lo.',
      status: 404,
    }
  }
  return { config: data as ActivationChannel, accountId }
}
