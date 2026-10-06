// Agente 3R de setup do CRM — criação do funil (função reutilizável).
// Usada tanto pela rota /api/ccc/setup-funil quanto pela amarração
// /api/ccc/processar. Cria o pipeline + as etapas numa conta, marcando a
// etapa de "conversa qualificada" (is_connection=true).
//
// Com `modeloId`, as etapas (função, prazo, cor), os motivos de perda e os
// campos vêm da biblioteca de modelos (src/lib/pipelines/modelos.ts).

import type { FuncaoEtapa } from '@/lib/pipelines/funcoes'
import { funcaoInfo } from '@/lib/pipelines/funcoes'
import { somarCampos, somarMotivos } from '@/lib/pipelines/aplicar-modelo'
import { diasDaEtapa, modeloPorId, toquesDaEtapa } from '@/lib/pipelines/modelos'
import type { Toque } from '@/lib/pipelines/toques'

export interface EtapaFunil {
  name: string
  is_connection: boolean
  funcao?: FuncaoEtapa
  dias_max?: number | null
  color?: string
  toques?: Toque[]
}

// Template padrão (ver 02-Operacao/template-funil-padrao.md).
export const ETAPAS_PADRAO: EtapaFunil[] = [
  { name: 'Novo lead', is_connection: false },
  { name: 'Contato feito', is_connection: false },
  { name: 'Conversa qualificada', is_connection: true },
  { name: 'Proposta enviada', is_connection: false },
  { name: 'Ganho', is_connection: false },
  { name: 'Perdido', is_connection: false },
]

export interface ResultadoFunil {
  ok: boolean
  pipeline_id?: string
  nome?: string
  etapas?: EtapaFunil[]
  reused?: boolean
  /** Modelo da biblioteca usado, quando houver. */
  modelo?: { id: string; nome: string }
  error?: string
}

export async function criarFunilPadrao(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  nomePipeline?: string
  etapas?: EtapaFunil[]
  modeloId?: string
}): Promise<ResultadoFunil> {
  const { supabase, accountId } = args
  const modelo = args.modeloId ? modeloPorId(args.modeloId) : undefined
  const nome =
    args.nomePipeline && args.nomePipeline.trim()
      ? args.nomePipeline.trim()
      : modelo?.nome ?? 'Comercial 3R'
  const etapas: EtapaFunil[] = modelo
    ? modelo.etapas.map((e) => ({
        name: e.nome,
        is_connection: e.funcao === 'conexao',
        funcao: e.funcao,
        dias_max: diasDaEtapa(e),
        color: funcaoInfo(e.funcao).cor,
        toques: toquesDaEtapa(modelo.id, e),
      }))
    : args.etapas && args.etapas.length > 0
      ? args.etapas
      : ETAPAS_PADRAO

  if (!accountId) return { ok: false, error: 'account_id é obrigatório.' }
  if (etapas.some((e) => !e.name)) {
    return { ok: false, error: 'Toda etapa precisa de um nome.' }
  }

  // Idempotência: se já existe um pipeline com esse nome na conta, reusa em vez
  // de criar outro (senão cada clique em "Gerar e revisar" duplica o funil).
  const { data: existente } = await supabase
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', nome)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existente) {
    const { data: stagesExist } = await supabase
      .from('pipeline_stages')
      .select('name, is_connection')
      .eq('pipeline_id', existente.id)
      .order('position', { ascending: true })
    return {
      ok: true,
      pipeline_id: existente.id,
      nome,
      etapas: (stagesExist ?? []).map(
        (s: { name: string; is_connection: boolean }) => ({
          name: s.name,
          is_connection: s.is_connection,
        }),
      ),
      reused: true,
      ...(modelo ? { modelo: { id: modelo.id, nome: modelo.nome } } : {}),
    }
  }

  // pipelines.user_id é NOT NULL — usa o owner da conta.
  const { data: owner, error: erroOwner } = await supabase
    .from('account_members')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('role', 'owner')
    .limit(1)
    .single()

  if (erroOwner || !owner) {
    return { ok: false, error: 'Conta sem owner — não é possível criar o funil.' }
  }

  const { data: pipeline, error: erroPipeline } = await supabase
    .from('pipelines')
    .insert({
      account_id: accountId,
      user_id: owner.user_id,
      name: nome,
      ...(modelo ? { modelo_id: modelo.id } : {}),
    })
    .select('id')
    .single()

  if (erroPipeline) return { ok: false, error: erroPipeline.message }

  // Sem `funcao`, o trigger da migration 103 sugere pelo nome.
  const stages = etapas.map((e, i) => ({
    pipeline_id: pipeline.id,
    name: e.name,
    position: i,
    is_connection: e.is_connection,
    ...(e.funcao ? { funcao: e.funcao } : {}),
    ...(e.dias_max !== undefined ? { dias_max: e.dias_max } : {}),
    ...(e.color ? { color: e.color } : {}),
    ...(e.toques ? { toques: e.toques } : {}),
  }))

  const { error: erroStages } = await supabase
    .from('pipeline_stages')
    .insert(stages)

  if (erroStages) return { ok: false, error: erroStages.message }

  if (modelo) {
    await somarMotivos(supabase, accountId, modelo.motivosPerda)
    await somarCampos(supabase, accountId, owner.user_id, modelo.campos)
  }

  return {
    ok: true,
    pipeline_id: pipeline.id,
    nome,
    etapas: stages.map((s) => ({ name: s.name, is_connection: s.is_connection })),
    ...(modelo ? { modelo: { id: modelo.id, nome: modelo.nome } } : {}),
  }
}
