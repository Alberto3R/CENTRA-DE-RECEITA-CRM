import { describe, expect, it } from 'vitest'

import { isFuncaoEtapa } from './funcoes'
import { CATEGORIAS, MODELO_PADRAO_ID, MODELOS, diasDaEtapa, modeloPorId } from './modelos'

describe('biblioteca de modelos de funil', () => {
  it('tem o modelo padrão e ids únicos', () => {
    expect(modeloPorId(MODELO_PADRAO_ID)).toBeDefined()
    expect(new Set(MODELOS.map((m) => m.id)).size).toBe(MODELOS.length)
  })

  for (const m of MODELOS) {
    describe(m.nome, () => {
      it('só usa funções e categorias válidas', () => {
        expect(CATEGORIAS).toContain(m.categoria)
        for (const e of m.etapas) expect(isFuncaoEtapa(e.funcao)).toBe(true)
      })

      it('começa na entrada e tem conexão, ganho e perdido — o painel depende disso', () => {
        const funcoes = m.etapas.map((e) => e.funcao)
        expect(funcoes[0]).toBe('entrada')
        expect(funcoes).toContain('conexao')
        expect(funcoes).toContain('ganho')
        expect(funcoes).toContain('perdido')
      })

      it('não tem etapa ativa depois do ganho', () => {
        const iGanho = m.etapas.findIndex((e) => e.funcao === 'ganho')
        for (const e of m.etapas.slice(iGanho + 1)) {
          expect(['perdido', 'reativacao']).toContain(e.funcao)
        }
      })

      it('tem no máximo 10 etapas, nomes únicos e critério em todas', () => {
        expect(m.etapas.length).toBeLessThanOrEqual(10)
        expect(new Set(m.etapas.map((e) => e.nome.toLowerCase())).size).toBe(m.etapas.length)
        for (const e of m.etapas) expect(e.criterio.trim().length).toBeGreaterThan(5)
      })

      it('etapa ativa tem prazo; ganho e perdido não', () => {
        for (const e of m.etapas) {
          const dias = diasDaEtapa(e)
          if (e.funcao === 'ganho' || e.funcao === 'perdido') expect(dias).toBeNull()
          else if (e.funcao !== 'reativacao') expect(dias).toBeGreaterThan(0)
        }
      })

      it('tem motivos de perda sem repetição, incluindo "Outro"', () => {
        expect(m.motivosPerda).toContain('Outro')
        expect(new Set(m.motivosPerda.map((r) => r.toLowerCase())).size).toBe(m.motivosPerda.length)
      })
    })
  }
})
