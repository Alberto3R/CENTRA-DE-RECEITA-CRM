// Régua de contato por etapa (migration 105): o que o vendedor faz em cada
// dia que o negócio passa na etapa. Dia 0 = o dia em que entrou nela.
//
// Cada função tem uma régua padrão; os modelos da biblioteca podem trocar a
// régua de uma etapa quando o segmento pede outra conversa (recuperação de
// pagamento, avaliação de clínica, visita à loja). [entre colchetes] é o que
// o vendedor completa antes de mandar.

import type { FuncaoEtapa } from './funcoes'

export type CanalToque = 'WhatsApp' | 'Ligação' | 'E-mail'

export interface Toque {
  dia: number
  canal: CanalToque
  /** O que fazer, em uma linha. */
  acao: string
  /** Mensagem sugerida (WhatsApp/e-mail) ou roteiro curto (ligação). */
  mensagem?: string
}

export const TOQUES_POR_FUNCAO: Record<FuncaoEtapa, Toque[]> = {
  entrada: [
    {
      dia: 0,
      canal: 'WhatsApp',
      acao: 'Responder em até 5 minutos',
      mensagem: 'Oi [nome]! Aqui é [seu nome], da [empresa]. Vi seu interesse — me conta rapidinho o que você está procurando?',
    },
  ],
  tentativa: [
    { dia: 1, canal: 'Ligação', acao: 'Ligar uma vez; se não atender, mandar áudio curto' },
    {
      dia: 2,
      canal: 'WhatsApp',
      acao: 'Última tentativa com pergunta fácil de responder',
      mensagem: 'Oi [nome], tentei falar com você ontem. Ainda faz sentido conversarmos sobre [assunto]? Pode me responder só com sim ou não.',
    },
  ],
  conexao: [
    {
      dia: 1,
      canal: 'WhatsApp',
      acao: 'Fazer a pergunta de qualificação que ficou faltando',
      mensagem: '[nome], pra eu te ajudar do jeito certo: [pergunta que falta — prazo, orçamento ou quem decide]?',
    },
  ],
  qualificado: [
    {
      dia: 0,
      canal: 'WhatsApp',
      acao: 'Propor o próximo passo com duas datas',
      mensagem: '[nome], o próximo passo é [visita / reunião / avaliação]. Fica melhor [dia 1] ou [dia 2]?',
    },
    { dia: 2, canal: 'Ligação', acao: 'Ligar para fechar a data do próximo passo' },
  ],
  compromisso: [
    {
      dia: 0,
      canal: 'WhatsApp',
      acao: 'Confirmar o compromisso na véspera',
      mensagem: 'Oi [nome], confirmando nosso [compromisso] [dia] às [hora]. Tudo certo por aí?',
    },
    {
      dia: 2,
      canal: 'WhatsApp',
      acao: 'Se aconteceu, mandar a proposta; se faltou, remarcar',
      mensagem: '[nome], ficou faltando a gente [se ver / conversar]. Quer remarcar para [dia 1] ou [dia 2]?',
    },
  ],
  proposta: [
    {
      dia: 1,
      canal: 'WhatsApp',
      acao: 'Perguntar o que achou da proposta',
      mensagem: '[nome], conseguiu olhar a proposta? Ficou alguma dúvida que eu possa tirar agora?',
    },
    { dia: 3, canal: 'Ligação', acao: 'Ligar para tratar a objeção que travou' },
    {
      dia: 5,
      canal: 'WhatsApp',
      acao: 'Dar prazo para a condição',
      mensagem: '[nome], consigo segurar essa condição até [data]. Depois disso preciso revisar. Faz sentido fecharmos até lá?',
    },
  ],
  decisao: [
    {
      dia: 1,
      canal: 'WhatsApp',
      acao: 'Destravar o que falta para fechar',
      mensagem: '[nome], para finalizarmos só falta [pagamento / documento / assinatura]. Consegue resolver hoje?',
    },
    { dia: 3, canal: 'Ligação', acao: 'Ligar e resolver junto o que está travando' },
  ],
  reativacao: [
    {
      dia: 7,
      canal: 'WhatsApp',
      acao: 'Retomar sem pressão',
      mensagem: 'Oi [nome], tudo bem? Passando para saber se [assunto] ainda está nos seus planos.',
    },
    {
      dia: 30,
      canal: 'WhatsApp',
      acao: 'Trazer novidade ou condição nova',
      mensagem: '[nome], apareceu [novidade / condição] que tem a ver com o que você procurava. Quer que eu te mande?',
    },
  ],
  ganho: [],
  perdido: [],
}

/**
 * Toque do dia: o mais avançado cujo dia já chegou. É o que o vendedor deve
 * fazer agora — os anteriores ou já foram feitos ou perderam a hora.
 */
export function toqueDoDia(toques: Toque[] | null | undefined, diasNaEtapa: number | null): Toque | null {
  if (!toques?.length || diasNaEtapa == null) return null
  let alvo: Toque | null = null
  for (const t of toques) if (t.dia <= diasNaEtapa && (!alvo || t.dia >= alvo.dia)) alvo = t
  return alvo
}

/** Normaliza o jsonb vindo do banco (pode ter lixo de edição manual). */
export function lerToques(raw: unknown): Toque[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Toque => !!t && typeof t === 'object' && Number.isFinite((t as Toque).dia) && typeof (t as Toque).acao === 'string')
    .map((t) => ({ dia: Math.max(0, Math.floor(t.dia)), canal: t.canal ?? 'WhatsApp', acao: t.acao, mensagem: t.mensagem }))
    .sort((a, b) => a.dia - b.dia)
}
