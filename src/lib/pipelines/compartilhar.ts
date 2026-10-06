import type { SupabaseClient } from '@supabase/supabase-js'

import type { PipelineStage } from '@/types'
import { funcaoInfo, isFuncaoEtapa, type FuncaoEtapa } from './funcoes'
import { lerToques, type Toque } from './toques'

// Compartilhar a ESTRUTURA de um funil por link (migration 107). O link leva
// só as etapas — nome, função, prazo, régua, cor. Negócio, contato e dado de
// cliente nunca entram na cópia.

export interface EtapaCompartilhada {
  nome: string
  funcao: FuncaoEtapa
  dias_max: number | null
  toques: Toque[]
  cor: string
}

export function copiarEtapas(stages: PipelineStage[]): EtapaCompartilhada[] {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => ({
      nome: s.name,
      funcao: s.funcao,
      dias_max: s.dias_max ?? null,
      toques: lerToques(s.toques),
      cor: s.color,
    }))
}

/** Valida o que veio do link (é dado de outra conta: não confiar no formato). */
export function lerEtapasCompartilhadas(raw: unknown): EtapaCompartilhada[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e) => e && typeof e === 'object' && typeof e.nome === 'string' && e.nome.trim())
    .slice(0, 20)
    .map((e) => {
      const funcao: FuncaoEtapa = isFuncaoEtapa(e.funcao) ? e.funcao : 'qualificado'
      const dias = Number(e.dias_max)
      return {
        nome: String(e.nome).slice(0, 80),
        funcao,
        dias_max: Number.isFinite(dias) && dias > 0 ? Math.floor(dias) : null,
        toques: lerToques(e.toques),
        cor: typeof e.cor === 'string' && /^#[0-9a-f]{6}$/i.test(e.cor) ? e.cor : funcaoInfo(funcao).cor,
      }
    })
}

function novoToken(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export async function criarLinkCompartilhamento(args: {
  supabase: SupabaseClient
  accountId: string
  userId: string
  pipelineId: string
  nome: string
  stages: PipelineStage[]
}): Promise<string> {
  const token = novoToken()
  const { error } = await args.supabase.from('funil_compartilhamentos').insert({
    token,
    account_id: args.accountId,
    pipeline_id: args.pipelineId,
    nome: args.nome,
    etapas: copiarEtapas(args.stages),
    criado_por: args.userId,
  })
  if (error) throw new Error('Não foi possível gerar o link. Só admins compartilham funis.')
  return token
}

export async function lerCompartilhamento(
  supabase: SupabaseClient,
  token: string,
): Promise<{ nome: string; etapas: EtapaCompartilhada[] } | null> {
  const { data } = await supabase.rpc('funil_compartilhado', { p_token: token })
  if (!data || typeof data !== 'object') return null
  const d = data as { nome?: unknown; etapas?: unknown }
  const etapas = lerEtapasCompartilhadas(d.etapas)
  if (etapas.length === 0) return null
  return { nome: typeof d.nome === 'string' ? d.nome : 'Funil compartilhado', etapas }
}

/** Cria na conta de quem importa um funil NOVO com as etapas do link. */
export async function importarCompartilhamento(args: {
  supabase: SupabaseClient
  accountId: string
  userId: string
  token: string
  nome: string
  etapas: EtapaCompartilhada[]
}): Promise<string> {
  const { supabase } = args
  const { data: pipeline, error } = await supabase
    .from('pipelines')
    .insert({ user_id: args.userId, account_id: args.accountId, name: args.nome })
    .select('id')
    .single()
  if (error || !pipeline) throw new Error('Não foi possível criar o funil. Só admins criam funis.')

  const { error: erroEtapas } = await supabase.from('pipeline_stages').insert(
    args.etapas.map((e, i) => ({
      pipeline_id: pipeline.id,
      name: e.nome,
      funcao: e.funcao,
      dias_max: e.dias_max,
      toques: e.toques,
      color: e.cor,
      position: i,
    })),
  )
  if (erroEtapas) {
    await supabase.from('pipelines').delete().eq('id', pipeline.id)
    throw new Error('Não foi possível criar as etapas do funil.')
  }
  await supabase.rpc('funil_compartilhado_usado', { p_token: args.token })
  return pipeline.id
}
