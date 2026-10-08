// Tipos e leituras da página "Resultado do agente" (RPC agente_resultado,
// migration 110). O cálculo pesado fica no banco; aqui só o que vira texto.

export interface ResultadoAgente {
  funil: {
    atendidos: number
    responderam: number
    qualificados: number
    ouviram_oferta: number
    encaminhados: number
    avancaram: number
    ganhos: number
    valor_ganho: number
  }
  mensagens: {
    agente: number
    lead: number
    humano: number
    resposta_mediana_seg: number | null
    fora_do_horario: number
  }
  custo: { turnos: number; falhas: number; agente_usd: number; revisao_usd: number }
  passagem: {
    sem_humano: number
    agente_encaminhou: number
    humano_antes_do_lead_responder: number
    humano_no_meio: number
    minutos_ate_humano_mediana: number | null
  }
  notas: { media: number | null; baixas: number; com_erro: number }
  interesse: Record<string, number>
  perfil: { campo: string; valor: string; n: number }[]
  dores: { conversation_id: string; dor: string; inicio_at: string }[]
  problemas: {
    conversation_id: string
    inicio_at: string
    nota: number | null
    erro: string | null
    resumo: string | null
    contato: string | null
  }[]
  origens: { origem: string; n: number }[]
}

export const OUTRAS_ORIGENS = '__outras__'

export interface EtapaFunilAgente {
  chave: keyof ResultadoAgente['funil']
  rotulo: string
  ajuda: string
  n: number
  /** % sobre os atendidos. */
  pct: number
}

const ETAPAS: { chave: EtapaFunilAgente['chave']; rotulo: string; ajuda: string }[] = [
  { chave: 'atendidos', rotulo: 'Atendidos', ajuda: 'Leads que o agente respondeu' },
  { chave: 'responderam', rotulo: 'Responderam', ajuda: 'Voltaram a escrever depois da 1ª resposta do agente' },
  { chave: 'qualificados', rotulo: 'Qualificados', ajuda: 'O agente descobriu os dados de qualificação' },
  { chave: 'ouviram_oferta', rotulo: 'Ouviram a oferta', ajuda: 'O agente apresentou o produto' },
  { chave: 'encaminhados', rotulo: 'Passados ao consultor', ajuda: 'O agente encaminhou a conversa' },
  { chave: 'avancaram', rotulo: 'Avançaram no funil', ajuda: 'Negócio em etapa de qualificado em diante' },
  { chave: 'ganhos', rotulo: 'Ganhos', ajuda: 'Negócio marcado como ganho' },
]

export function etapasDoFunil(f: ResultadoAgente['funil']): EtapaFunilAgente[] {
  const base = f.atendidos || 0
  return ETAPAS.map((e) => ({
    ...e,
    n: f[e.chave],
    pct: base > 0 ? Math.round((f[e.chave] / base) * 100) : 0,
  }))
}

export function rotuloOrigem(origem: string): string {
  if (origem === OUTRAS_ORIGENS) return 'Outras origens'
  return `“${origem}${origem.length >= 47 ? '…' : ''}”`
}

export function formatarSegundos(s: number | null | undefined): string {
  if (s == null) return '—'
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 172800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} dias`
}

/** Valores de qualificação em snake_case viram texto: "pos_graduando" → "Pos graduando". */
export function rotuloValor(v: string): string {
  if (v === 'true' || v === 'sim') return 'Sim'
  if (v === 'false' || v === 'nao') return 'Não'
  const t = v.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
