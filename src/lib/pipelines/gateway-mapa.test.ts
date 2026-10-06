import { describe, expect, it } from 'vitest'

import { ALIASES_GATEWAY, sugerirMapaGateway } from './gateway-mapa'
import { modeloPorId } from './modelos'

describe('sugerirMapaGateway', () => {
  it('no modelo de recuperação, pendências caem na entrada e a compra no ganho', () => {
    const etapas = modeloPorId('recuperacao')!.etapas.map((e, i) => ({
      id: e.nome,
      position: i,
      funcao: e.funcao,
    }))
    const mapa = sugerirMapaGateway(etapas)
    for (const k of ALIASES_GATEWAY.abandono) expect(mapa[k]).toBe('Pagamento pendente')
    for (const k of ALIASES_GATEWAY.recuperacao) expect(mapa[k]).toBe('Pagamento pendente')
    for (const k of ALIASES_GATEWAY.compra) expect(mapa[k]).toBe('Recuperado')
    for (const k of ALIASES_GATEWAY.refund) expect(mapa[k]).toBe('refund')
  })

  it('sem etapa da função, o evento fica sem mapa', () => {
    const mapa = sugerirMapaGateway([{ id: 'x', position: 0, funcao: 'conexao' }])
    expect(mapa.salePaid).toBeUndefined()
    expect(mapa.checkoutAbandoned).toBeUndefined()
    expect(mapa.saleRefunded).toBe('refund')
  })

  it('usa a primeira etapa da função pela posição, não pela ordem da lista', () => {
    const mapa = sugerirMapaGateway([
      { id: 'tarde', position: 5, funcao: 'ganho' },
      { id: 'cedo', position: 2, funcao: 'ganho' },
    ])
    expect(mapa.salePaid).toBe('cedo')
  })
})
