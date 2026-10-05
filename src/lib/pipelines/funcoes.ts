// Função de cada etapa do funil (migration 103). O nome da etapa é do
// cliente; a função é fixa e é o que o painel mede — por isso qualquer modelo
// de funil mostra as mesmas taxas e renomear etapa não quebra métrica.

export type FuncaoEtapa =
  | 'entrada'
  | 'tentativa'
  | 'conexao'
  | 'qualificado'
  | 'compromisso'
  | 'proposta'
  | 'decisao'
  | 'ganho'
  | 'perdido'
  | 'reativacao'

export interface FuncaoInfo {
  id: FuncaoEtapa
  label: string
  /** O que precisa ter acontecido para o negócio estar nesta função. */
  descricao: string
  /** Cor padrão de etapa criada a partir de modelo. */
  cor: string
  /** Prazo padrão na etapa antes do card ficar vermelho. null = sem alerta. */
  diasPadrao: number | null
}

export const FUNCOES: FuncaoInfo[] = [
  { id: 'entrada', label: 'Entrada', descricao: 'O lead chegou (formulário, anúncio, base, carrinho).', cor: '#3b82f6', diasPadrao: 1 },
  { id: 'tentativa', label: 'Tentativa de contato', descricao: 'Estamos tentando falar; ainda não houve conversa de verdade.', cor: '#6366f1', diasPadrao: 2 },
  { id: 'conexao', label: 'Conexão', descricao: 'O lead respondeu e houve conversa real.', cor: '#06b6d4', diasPadrao: 2 },
  { id: 'qualificado', label: 'Qualificado', descricao: 'Tem perfil, necessidade e condição de comprar.', cor: '#eab308', diasPadrao: 3 },
  { id: 'compromisso', label: 'Compromisso', descricao: 'O lead se comprometeu com um passo: visita, reunião, avaliação, test drive.', cor: '#f97316', diasPadrao: 3 },
  { id: 'proposta', label: 'Proposta', descricao: 'Recebeu proposta, orçamento ou cotação.', cor: '#8b5cf6', diasPadrao: 5 },
  { id: 'decisao', label: 'Decisão', descricao: 'Negociando ou finalizando pagamento, documentos, crédito.', cor: '#ec4899', diasPadrao: 3 },
  // Fim de linha: negócio ganho/perdido não "atrasa"; reativação tem ritmo próprio.
  { id: 'ganho', label: 'Ganho', descricao: 'Comprou.', cor: '#22c55e', diasPadrao: null },
  { id: 'perdido', label: 'Perdido', descricao: 'Não vai comprar agora.', cor: '#f43f5e', diasPadrao: null },
  { id: 'reativacao', label: 'Reativação', descricao: 'Parou de responder ou faltou; volta a ser trabalhado depois.', cor: '#14b8a6', diasPadrao: null },
]

/** Dias na etapa, contados a partir de quando o negócio entrou nela. */
export function diasNaEtapa(stageEnteredAt: string | null | undefined, agora = Date.now()): number | null {
  if (!stageEnteredAt) return null
  const t = new Date(stageEnteredAt).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((agora - t) / 86_400_000))
}

const POR_ID = new Map(FUNCOES.map((f) => [f.id, f]))

export function funcaoInfo(id: string | null | undefined): FuncaoInfo {
  return POR_ID.get(id as FuncaoEtapa) ?? POR_ID.get('qualificado')!
}

export function isFuncaoEtapa(x: unknown): x is FuncaoEtapa {
  return typeof x === 'string' && POR_ID.has(x as FuncaoEtapa)
}
