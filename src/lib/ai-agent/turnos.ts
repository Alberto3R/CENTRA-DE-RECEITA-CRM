// Registro de cada rodada do agente (ai_agente_turnos, migration 110): o que
// ele decidiu — intenção, handoff, resumo — e quanto custou. É a matéria-prima
// da página "Resultado do agente". Telemetria nunca derruba o atendimento:
// erro aqui só vai pro log.

import type { SupabaseClient } from '@supabase/supabase-js'
import { calcularCustoUsd } from '@/lib/ai/custo'
import type { ModeloAnthropic } from '@/lib/ai/anthropic'
import type { AgentReply } from './respond'

export async function registrarTurno(
  supabase: SupabaseClient,
  p: {
    accountId: string
    conversationId: string
    agentId: string | null
    reply?: AgentReply | null
    /** Rodada sem resposta da IA (erro de API, JSON inválido). */
    falhou?: boolean
    /** Sobrescreve a intenção (ex.: 'descartada' quando outra rodada respondeu). */
    intencao?: string
    handoffMotivo?: string
  },
): Promise<void> {
  const r = p.reply
  const uso = r?.uso
  try {
    const { error } = await supabase.from('ai_agente_turnos').insert({
      account_id: p.accountId,
      conversation_id: p.conversationId,
      agent_id: p.agentId,
      intencao: p.intencao ?? (r?.intencao || null),
      handoff: r?.handoff ?? false,
      handoff_motivo: p.handoffMotivo ?? (r?.handoff_motivo || null),
      resumo: r?.resumo || null,
      silencio: r?.silencio ?? false,
      falhou: p.falhou ?? false,
      modelo: uso?.modelo ?? null,
      tokens_in: uso?.tokens_in ?? 0,
      tokens_out: uso?.tokens_out ?? 0,
      custo_usd: uso
        ? calcularCustoUsd(uso.modelo as ModeloAnthropic, uso.tokens_in, uso.tokens_out)
        : 0,
    })
    if (error) console.error('[ai-agent] registrar turno falhou:', error.message)
  } catch (e) {
    console.error('[ai-agent] registrar turno lançou:', e)
  }
}
