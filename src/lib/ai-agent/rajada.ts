// Uma resposta por vez: o agente espera o lead terminar de digitar e nunca
// responde em cima de outra rodada.
//
// Antes, a âncora do guarda era o início da rodada (runStartedAt). Escapava o
// caso em que o 2º balão do lead chega no mesmo segundo em que a rodada
// anterior está enviando: a rodada nova lia o histórico sem a resposta que
// acabara de sair e perguntava de novo ("Você já tem graduação completa?" e,
// 14 s depois, "Boa tarde! Tem graduação completa?" — conta do Ranieri,
// 25/10; 14 casos em 10 conversas entre 09 e 27/10).
//
// Agora a âncora é a própria mensagem do lead que disparou a rodada:
// - mensagem do lead mais nova que ela → a rodada da mais nova responde,
//   com todos os balões no histórico;
// - outra rodada do agente que respondeu depois que ela chegou → a vez é do
//   lead (a mensagem fica no histórico da próxima rodada).
// O 2º critério olha ai_agente_turnos, e não as mensagens do bot, porque
// automação também grava como 'bot' (entrega de isca por palavra-chave) e o
// agente deve continuar a conversa depois dela. O turno é gravado depois do
// último balão, então cobre também o balão do lead que cruza com o envio.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Quanto o agente espera depois da mensagem do lead antes de pensar. */
export const ESPERA_RAJADA_MS = 6000

export function esperar(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
}

/** Quando chegou a mensagem do lead que disparou esta rodada. */
export async function momentoDaMensagem(
  supabase: SupabaseClient,
  conversationId: string,
  inboundText: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .eq('content_text', inboundText)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { created_at?: string } | null)?.created_at ?? null
}

/**
 * Por que esta rodada não deve responder — ou null se deve.
 * `desde` é o momento da mensagem que disparou a rodada.
 */
export async function rodadaCoberta(
  supabase: SupabaseClient,
  conversationId: string,
  desde: string,
): Promise<'mensagem_nova' | 'outra_rodada' | null> {
  const [{ count: novas }, { count: respostas }] = await Promise.all([
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .gt('created_at', desde),
    supabase
      .from('ai_agente_turnos')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('silencio', false)
      .eq('falhou', false)
      .or('intencao.is.null,intencao.neq.descartada')
      .gt('created_at', desde),
  ])
  if ((novas ?? 0) > 0) return 'mensagem_nova'
  if ((respostas ?? 0) > 0) return 'outra_rodada'
  return null
}
