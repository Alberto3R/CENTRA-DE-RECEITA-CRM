// Saúde do funil: transforma as métricas por etapa (RPC pipeline_saude,
// migration 106) em sugestões que o gestor entende e consegue aplicar.
//
// As regras foram calibradas com os funis reais das contas (out/2026): o
// que mais aparece não é etapa sobrando — é negócio largado na coluna de
// "Perdido" sem ser marcado como perdido, e lead acumulando na entrada sem
// ninguém prospectar.

import { funcaoInfo, type FuncaoEtapa } from './funcoes'

export interface MetricaEtapa {
  stage_id: string
  entradas_90d: number
  mediana_horas: number | null
  abertos: number
  parados: number
}

export interface EtapaSaude {
  id: string
  name: string
  position: number
  funcao: FuncaoEtapa
  dias_max?: number | null
}

export type TipoSugestao =
  | 'perdido_aberto'
  | 'acumulando'
  | 'parados'
  | 'sem_passagem'
  | 'passa_direto'
  | 'sem_prazo'

export interface Sugestao {
  tipo: TipoSugestao
  stage_id: string
  /** 3 = resolver hoje · 2 = importante · 1 = ajuste fino */
  peso: 1 | 2 | 3
  titulo: string
  detalhe: string
}

const FIM: FuncaoEtapa[] = ['ganho', 'perdido', 'reativacao']

export function sugestoesDoFunil(etapas: EtapaSaude[], metricas: MetricaEtapa[]): Sugestao[] {
  const por = new Map(metricas.map((m) => [m.stage_id, m]))
  const totalEntradas = metricas.reduce((s, m) => s + m.entradas_90d, 0)
  const out: Sugestao[] = []

  for (const e of [...etapas].sort((a, b) => a.position - b.position)) {
    const m = por.get(e.id)
    if (!m) continue
    const horasPadrao = (funcaoInfo(e.funcao).diasPadrao ?? 0) * 24

    // Negócio na coluna de perdido mas ainda aberto: não entra no motivo de
    // perda nem sai da conta de abertos. É o achado mais comum.
    if (e.funcao === 'perdido' && m.abertos > 0) {
      out.push({
        tipo: 'perdido_aberto',
        stage_id: e.id,
        peso: 3,
        titulo: `${m.abertos} negócio(s) em "${e.name}" ainda abertos`,
        detalhe:
          'Estão na coluna de perdido, mas ninguém marcou como perdido. Marque com o motivo — sem isso eles não aparecem em "Motivos de perda" e inflam os abertos.',
      })
      continue
    }
    if (FIM.includes(e.funcao)) continue

    // Lead acumulando: muita gente aberta que fica dias, bem acima do ritmo
    // esperado para a função.
    if (m.abertos >= 20 && m.mediana_horas != null && horasPadrao > 0 && m.mediana_horas > horasPadrao * 3) {
      out.push({
        tipo: 'acumulando',
        stage_id: e.id,
        peso: 3,
        titulo: `${m.abertos} negócios acumulados em "${e.name}"`,
        detalhe: `Quem sai daqui leva em média ${formatarHoras(m.mediana_horas)}, quando o esperado é até ${funcaoInfo(e.funcao).diasPadrao} dia(s). Falta gente trabalhando esta etapa ou o critério para sair dela está alto demais.`,
      })
    }

    if (e.dias_max && m.abertos >= 5 && m.parados / m.abertos >= 0.3) {
      out.push({
        tipo: 'parados',
        stage_id: e.id,
        peso: 2,
        titulo: `${m.parados} de ${m.abertos} parados em "${e.name}"`,
        detalhe: `Passaram do prazo de ${e.dias_max} dia(s). Se o prazo é curto para a realidade, aumente; se não, a etapa está travando — vale dividir em duas ou rever o critério de avanço.`,
      })
    }

    // Ninguém passa: etapa que o time pula.
    if (m.entradas_90d === 0 && totalEntradas >= 50 && e.funcao !== 'entrada') {
      out.push({
        tipo: 'sem_passagem',
        stage_id: e.id,
        peso: 2,
        titulo: `Ninguém passou por "${e.name}" em 90 dias`,
        detalhe: 'O time pula esta etapa. Ou ela não existe na prática (remova), ou os negócios estão sendo movidos direto para a seguinte (oriente o time).',
      })
    }

    // Passa direto: todo mundo entra e sai na hora — etapa que não decide nada.
    if (
      m.entradas_90d >= 15 &&
      m.mediana_horas != null &&
      m.mediana_horas < 1 &&
      e.funcao !== 'entrada'
    ) {
      out.push({
        tipo: 'passa_direto',
        stage_id: e.id,
        peso: 1,
        titulo: `"${e.name}" é atravessada em menos de 1 hora`,
        detalhe: 'Quase ninguém fica nesta etapa. Se ela não muda a próxima ação do vendedor, junte com a seguinte.',
      })
    }

    if (!e.dias_max && m.abertos >= 10) {
      out.push({
        tipo: 'sem_prazo',
        stage_id: e.id,
        peso: 1,
        titulo: `"${e.name}" não tem prazo`,
        detalhe: `Com ${m.abertos} negócios abertos aqui, defina o prazo da etapa para o card ficar vermelho quando alguém ficar parado. Padrão da função: ${funcaoInfo(e.funcao).diasPadrao ?? '—'} dia(s).`,
      })
    }
  }

  return out.sort((a, b) => b.peso - a.peso)
}

function formatarHoras(h: number): string {
  if (h >= 48) return `${Math.round(h / 24)} dias`
  if (h >= 1) return `${Math.round(h)} h`
  return `${Math.max(1, Math.round(h * 60))} min`
}
