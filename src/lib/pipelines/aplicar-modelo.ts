import type { SupabaseClient } from '@supabase/supabase-js'

import { funcaoInfo } from './funcoes'
import { diasDaEtapa, toquesDaEtapa, type ModeloFunil } from './modelos'

export interface ResultadoAplicacao {
  pipelineId: string
  motivosNovos: number
  camposNovos: number
}

// Cria um funil NOVO a partir do modelo. Nunca mexe em funil existente —
// renomear funil quebra automação que dispara pelo nome.
//
// Motivos de perda e campos são da conta inteira (não do funil): entram só
// os que ainda não existem, comparando sem diferenciar maiúscula. Roda com o
// client do usuário, então vale o RLS de quem pode editar configurações.
export async function aplicarModelo(args: {
  supabase: SupabaseClient
  accountId: string
  userId: string
  modelo: ModeloFunil
  nomeFunil: string
}): Promise<ResultadoAplicacao> {
  const { supabase, accountId, userId, modelo } = args
  const nome = args.nomeFunil.trim() || modelo.nome

  const { data: pipeline, error } = await supabase
    .from('pipelines')
    // modelo_id (migration 106) guarda a origem — base da comparação por segmento.
    .insert({ user_id: userId, account_id: accountId, name: nome, modelo_id: modelo.id })
    .select('id')
    .single()
  if (error || !pipeline) throw new Error('Não foi possível criar o funil.')

  const { error: erroEtapas } = await supabase.from('pipeline_stages').insert(
    modelo.etapas.map((e, i) => ({
      pipeline_id: pipeline.id,
      name: e.nome,
      funcao: e.funcao,
      color: funcaoInfo(e.funcao).cor,
      dias_max: diasDaEtapa(e),
      toques: toquesDaEtapa(modelo.id, e),
      position: i,
    })),
  )
  if (erroEtapas) {
    // Funil sem etapa não serve pra nada; desfaz em vez de deixar lixo.
    await supabase.from('pipelines').delete().eq('id', pipeline.id)
    throw new Error('Não foi possível criar as etapas do funil.')
  }

  const motivosNovos = await somarMotivos(supabase, accountId, modelo.motivosPerda)
  const camposNovos = await somarCampos(supabase, accountId, userId, modelo.campos)

  return { pipelineId: pipeline.id, motivosNovos, camposNovos }
}

export async function somarMotivos(
  supabase: SupabaseClient,
  accountId: string,
  motivos: string[],
): Promise<number> {
  if (motivos.length === 0) return 0
  const { data: atuais } = await supabase
    .from('loss_reasons')
    .select('reason, position')
    .eq('account_id', accountId)
  const existentes = new Set((atuais ?? []).map((r) => String(r.reason).toLowerCase()))
  let pos = Math.max(-1, ...(atuais ?? []).map((r) => Number(r.position) || 0)) + 1
  const novos = motivos
    .filter((m) => !existentes.has(m.toLowerCase()))
    .map((reason) => ({ account_id: accountId, reason, position: pos++ }))
  if (novos.length === 0) return 0
  const { error } = await supabase.from('loss_reasons').insert(novos)
  return error ? 0 : novos.length
}

export async function somarCampos(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  campos: string[],
): Promise<number> {
  if (campos.length === 0) return 0
  const { data: atuais } = await supabase
    .from('custom_fields')
    .select('field_name')
    .eq('account_id', accountId)
  const existentes = new Set((atuais ?? []).map((f) => String(f.field_name).toLowerCase()))
  const novos = campos
    .filter((c) => !existentes.has(c.toLowerCase()))
    .map((field_name) => ({ account_id: accountId, user_id: userId, field_name, field_type: 'text' }))
  if (novos.length === 0) return 0
  const { error } = await supabase.from('custom_fields').insert(novos)
  return error ? 0 : novos.length
}
