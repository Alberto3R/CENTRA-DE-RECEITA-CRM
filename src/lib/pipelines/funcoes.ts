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
}

export const FUNCOES: FuncaoInfo[] = [
  { id: 'entrada', label: 'Entrada', descricao: 'O lead chegou (formulário, anúncio, base, carrinho).', cor: '#3b82f6' },
  { id: 'tentativa', label: 'Tentativa de contato', descricao: 'Estamos tentando falar; ainda não houve conversa de verdade.', cor: '#6366f1' },
  { id: 'conexao', label: 'Conexão', descricao: 'O lead respondeu e houve conversa real.', cor: '#06b6d4' },
  { id: 'qualificado', label: 'Qualificado', descricao: 'Tem perfil, necessidade e condição de comprar.', cor: '#eab308' },
  { id: 'compromisso', label: 'Compromisso', descricao: 'O lead se comprometeu com um passo: visita, reunião, avaliação, test drive.', cor: '#f97316' },
  { id: 'proposta', label: 'Proposta', descricao: 'Recebeu proposta, orçamento ou cotação.', cor: '#8b5cf6' },
  { id: 'decisao', label: 'Decisão', descricao: 'Negociando ou finalizando pagamento, documentos, crédito.', cor: '#ec4899' },
  { id: 'ganho', label: 'Ganho', descricao: 'Comprou.', cor: '#22c55e' },
  { id: 'perdido', label: 'Perdido', descricao: 'Não vai comprar agora.', cor: '#f43f5e' },
  { id: 'reativacao', label: 'Reativação', descricao: 'Parou de responder ou faltou; volta a ser trabalhado depois.', cor: '#14b8a6' },
]

const POR_ID = new Map(FUNCOES.map((f) => [f.id, f]))

export function funcaoInfo(id: string | null | undefined): FuncaoInfo {
  return POR_ID.get(id as FuncaoEtapa) ?? POR_ID.get('qualificado')!
}

export function isFuncaoEtapa(x: unknown): x is FuncaoEtapa {
  return typeof x === 'string' && POR_ID.has(x as FuncaoEtapa)
}
