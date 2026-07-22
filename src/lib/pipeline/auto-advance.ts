// Auto-avanço de funil — opt-in POR PIPELINE (multi-tenant safe).
//
// Dois gatilhos, ambos desligados por padrão (colunas em `pipelines`,
// migration 078):
//   - auto_advance_on_reply: na PRIMEIRA resposta do contato, o negócio sai
//     da primeira etapa (position mínima) para a segunda. O funil passa a
//     refletir "conversa ativa" sem intervenção manual.
//   - call_booked_stage_id: quando o agente agenda a call (agendar_call),
//     o negócio vai para essa etapa (ex.: "Diagnóstico agendado").
//
// Só negócios `status='open'` se movem; o histórico fica no trigger de
// deal_stage_events (migration 073), que registra qualquer mudança de etapa.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

/** Primeira resposta do contato → 1ª etapa vira 2ª nos pipelines opt-in. */
export async function advanceDealsOnFirstReply(
  admin: Admin,
  accountId: string,
  contactId: string,
): Promise<void> {
  try {
    const { data: pipes } = await admin
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .eq('auto_advance_on_reply', true)
    if (!pipes?.length) return

    for (const pipe of pipes) {
      const { data: stages } = await admin
        .from('pipeline_stages')
        .select('id, position')
        .eq('pipeline_id', pipe.id)
        .order('position', { ascending: true })
        .limit(2)
      const first = stages?.[0]
      const second = stages?.[1]
      if (!first || !second) continue

      await admin
        .from('deals')
        .update({ stage_id: second.id, updated_at: new Date().toISOString() })
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('pipeline_id', pipe.id)
        .eq('stage_id', first.id)
        .eq('status', 'open')
    }
  } catch (e) {
    // Best-effort: falha aqui nunca pode derrubar o processamento da mensagem.
    console.error('[auto-advance] first-reply falhou:', e)
  }
}

/** Call agendada pelo agente → negócio vai pra etapa configurada no pipeline. */
export async function advanceDealsOnCallBooked(
  admin: Admin,
  accountId: string,
  contactId: string,
): Promise<void> {
  try {
    const { data: pipes } = await admin
      .from('pipelines')
      .select('id, call_booked_stage_id')
      .eq('account_id', accountId)
      .not('call_booked_stage_id', 'is', null)
    if (!pipes?.length) return

    for (const pipe of pipes) {
      await admin
        .from('deals')
        .update({
          stage_id: pipe.call_booked_stage_id,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('pipeline_id', pipe.id)
        .eq('status', 'open')
        .neq('stage_id', pipe.call_booked_stage_id)
    }
  } catch (e) {
    console.error('[auto-advance] call-booked falhou:', e)
  }
}
