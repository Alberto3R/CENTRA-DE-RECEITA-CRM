import { describe, expect, it } from 'vitest'

import { sugestoesDoFunil, type EtapaSaude, type MetricaEtapa } from './saude'

// Formato tirado dos funis reais (Pós ESFS, Aula Ao vivo) em out/2026.
const etapas: EtapaSaude[] = [
  { id: 'novo', name: 'Novo lead', position: 0, funcao: 'entrada', dias_max: null },
  { id: 'prosp', name: 'Prospecção', position: 1, funcao: 'tentativa', dias_max: 2 },
  { id: 'conx', name: 'Conexão', position: 2, funcao: 'conexao', dias_max: null },
  { id: 'aguard', name: 'Aguardando pagamento', position: 3, funcao: 'decisao', dias_max: 3 },
  { id: 'ganho', name: 'Ganho', position: 4, funcao: 'ganho', dias_max: null },
  { id: 'perd', name: 'Perdido', position: 5, funcao: 'perdido', dias_max: null },
]

function m(stage_id: string, o: Partial<MetricaEtapa>): MetricaEtapa {
  return { stage_id, entradas_90d: 0, mediana_horas: null, abertos: 0, parados: 0, ...o }
}

describe('sugestoesDoFunil', () => {
  const metricas = [
    m('novo', { entradas_90d: 427, mediana_horas: 154.5, abertos: 411 }),
    m('prosp', { entradas_90d: 20, mediana_horas: 0.5, abertos: 10, parados: 6 }),
    m('conx', { entradas_90d: 30, mediana_horas: 24, abertos: 12 }),
    m('aguard', { entradas_90d: 0 }),
    m('ganho', { entradas_90d: 3 }),
    m('perd', { entradas_90d: 131, mediana_horas: 70, abertos: 39 }),
  ]
  const s = sugestoesDoFunil(etapas, metricas)
  const tipos = (id: string) => s.filter((x) => x.stage_id === id).map((x) => x.tipo)

  it('acusa negócio aberto na coluna de perdido, e isso vem primeiro', () => {
    expect(tipos('perd')).toEqual(['perdido_aberto'])
    expect(s[0].peso).toBe(3)
  })

  it('acusa lead acumulando na entrada', () => {
    expect(tipos('novo')).toContain('acumulando')
  })

  it('acusa parados acima de 30% e etapa atravessada direto', () => {
    expect(tipos('prosp')).toEqual(expect.arrayContaining(['parados', 'passa_direto']))
  })

  it('acusa etapa sem passagem e etapa movimentada sem prazo', () => {
    expect(tipos('aguard')).toEqual(['sem_passagem'])
    expect(tipos('conx')).toEqual(['sem_prazo'])
  })

  it('não sugere nada para ganho, nem em funil vazio', () => {
    expect(tipos('ganho')).toEqual([])
    expect(sugestoesDoFunil(etapas, etapas.map((e) => m(e.id, {})))).toEqual([])
  })

  it('ordena do mais grave para o ajuste fino', () => {
    const pesos = s.map((x) => x.peso)
    expect([...pesos].sort((a, b) => b - a)).toEqual(pesos)
  })
})
