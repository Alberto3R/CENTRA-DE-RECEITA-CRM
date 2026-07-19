// Agente 3R de setup do CRM — criação do funil (função reutilizável).
// Usada tanto pela rota /api/ccc/setup-funil quanto pela amarração
// /api/ccc/processar. Cria o pipeline + as etapas numa conta, marcando a
// etapa de "conversa qualificada" (is_connection=true).

export interface EtapaFunil {
  name: string
  is_connection: boolean
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
  error?: string
}

export async function criarFunilPadrao(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  nomePipeline?: string
  etapas?: EtapaFunil[]
}): Promise<ResultadoFunil> {
  const { supabase, accountId } = args
  const nome =
    args.nomePipeline && args.nomePipeline.trim()
      ? args.nomePipeline.trim()
      : 'Comercial 3R'
  const etapas =
    args.etapas && args.etapas.length > 0 ? args.etapas : ETAPAS_PADRAO

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
    .insert({ account_id: accountId, user_id: owner.user_id, name: nome })
    .select('id')
    .single()

  if (erroPipeline) return { ok: false, error: erroPipeline.message }

  const stages = etapas.map((e, i) => ({
    pipeline_id: pipeline.id,
    name: e.name,
    position: i,
    is_connection: e.is_connection,
  }))

  const { error: erroStages } = await supabase
    .from('pipeline_stages')
    .insert(stages)

  if (erroStages) return { ok: false, error: erroStages.message }

  return {
    ok: true,
    pipeline_id: pipeline.id,
    nome,
    etapas: stages.map((s) => ({ name: s.name, is_connection: s.is_connection })),
  }
}
