import { describe, expect, it } from 'vitest'

import { extrairToquesAtivos } from './acompanhamento'

const t = (quando: string) => ({ quando, canal: 'WhatsApp', acao: 'x' })

describe('extrairToquesAtivos', () => {
  it('lê o formato D+N', () => {
    const toques = extrairToquesAtivos([t('D+0'), t('D + 3'), t('D+7 — último toque')])
    expect(toques.map((x) => x.dia)).toEqual([0, 3, 7])
  })

  it('lê o formato "Dia N" que o agente gerador também usa', () => {
    // Régua real aprovada na conta MA Decorações (02/out/2026).
    const toques = extrairToquesAtivos([
      t('Dia 0 — imediatamente após o lead entrar'),
      t('Dia 0 — até 10 minutos após o pré-atendimento'),
      t('Dia 1 — se o lead não respondeu à qualificação'),
      t('Dia 2 — se ainda sem resposta'),
      t('Dia 4 — se sem resposta após ligação'),
      t('Dia 7 — se ainda sem resposta'),
      t('Dia 30 — leads frios / proposta enviada sem retorno'),
      t('Dia 7 após a entrega do produto (pós-venda)'),
      t('Dia 30 após a entrega (fidelização)'),
    ])
    expect(toques.map((x) => x.dia)).toEqual([0, 0, 1, 2, 4, 7, 30])
  })

  it('ignora recorrentes e pós-fechamento', () => {
    const toques = extrairToquesAtivos([
      t('Toda segunda — reunião do gestor'),
      t('D+2 após fechamento'),
      t('Dia 15 de recompra'),
    ])
    expect(toques).toEqual([])
  })

  it('ignora o que não tem dia', () => {
    expect(extrairToquesAtivos([t('quando der')])).toEqual([])
    expect(extrairToquesAtivos(null)).toEqual([])
  })
})
