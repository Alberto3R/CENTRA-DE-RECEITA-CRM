/**
 * Teto diário de envio por caixa.
 *
 * Por que isto existe: estourar a capacidade de uma caixa NÃO devolve erro. O
 * provedor aceita, e quem degrada é a reputação do domínio — silenciosamente,
 * ao longo de dias, até o e-mail parar de chegar na caixa de entrada. Não dá
 * pra descobrir pelo retorno da API; tem que ser barrado na origem.
 *
 * A contagem sai de `messages` (as que saíram por este canal hoje), não de um
 * contador próprio: uma linha só de verdade, imune a worker reiniciado ou
 * processo duplicado.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Início do dia corrente em América/São_Paulo, como ISO UTC.
 *  O teto é por DIA COMERCIAL do operador, não por período de 24h corrido. */
export function inicioDoDiaBrasilISO(agora: Date = new Date()): string {
  // -03:00 fixo. O Brasil não tem horário de verão desde 2019; se voltar,
  // trocar por Intl.DateTimeFormat com timeZone.
  const OFFSET_MS = 3 * 60 * 60 * 1000
  const local = new Date(agora.getTime() - OFFSET_MS)
  local.setUTCHours(0, 0, 0, 0)
  return new Date(local.getTime() + OFFSET_MS).toISOString()
}

export interface QuotaStatus {
  enviadosHoje: number
  limite: number
  restante: number
  estourou: boolean
}

/**
 * Quantos e-mails este canal já mandou hoje, e quanto ainda cabe.
 *
 * Conta apenas mensagens de saída (`sender_type <> 'customer'` — ver a regra do
 * CRM: quem entra é sempre 'customer') em conversas deste canal.
 */
export async function consultarQuota(
  db: SupabaseClient,
  channelId: string,
  limite: number,
): Promise<QuotaStatus> {
  const desde = inicioDoDiaBrasilISO()

  const { data: convs, error: convErr } = await db
    .from('conversations')
    .select('id')
    .eq('channel_id', channelId)

  if (convErr) throw new Error(`quota: falha ao listar conversas: ${convErr.message}`)

  const ids = (convs ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) {
    return { enviadosHoje: 0, limite, restante: limite, estourou: false }
  }

  const { count, error } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .neq('sender_type', 'customer')
    .gte('created_at', desde)

  if (error) throw new Error(`quota: falha ao contar envios: ${error.message}`)

  const enviadosHoje = count ?? 0
  const restante = Math.max(0, limite - enviadosHoje)
  return { enviadosHoje, limite, restante, estourou: enviadosHoje >= limite }
}

/** Intervalo aleatório entre dois envios, em ms.
 *
 *  Rajada uniforme é assinatura de robô — os filtros leem cadência. O padrão
 *  (45s a 3min) espalha ~50 envios ao longo de uma manhã de trabalho, que é
 *  como um humano manda. */
export function intervaloEntreEnvios(
  minMs = 45_000,
  maxMs = 180_000,
): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs))
}
