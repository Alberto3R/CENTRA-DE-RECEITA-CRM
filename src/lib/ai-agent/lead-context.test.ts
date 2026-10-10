import { describe, expect, it } from 'vitest'
import { leadContextFrom } from './lead-context'

describe('leadContextFrom', () => {
  it('formulário da Meta vira contexto legível, sem campos técnicos nem telefone', () => {
    const t = leadContextFrom({
      leadgen_id: '123',
      'qual_a_sua_formação?': 'psicóloga',
      'como_você_descreve_o_seu_momento_na_carreira?': 'quero_fazer_minha_transição_de_carreira',
      'quanto_pretende_investir?': 'de_r$_500_a_r$_1.000',
      full_name: 'Zenite',
      phone_number: '+5521999999999',
      email: 'z@exemplo.com',
    })!
    expect(t).toContain('NÃO pergunte de novo')
    expect(t).toContain('- Qual a sua formação?: psicóloga')
    expect(t).toContain('quero fazer minha transição de carreira')
    expect(t).toContain('de r$ 500 a r$ 1.000')
    expect(t).toContain('z@exemplo.com')
    expect(t).not.toContain('123')
    expect(t).not.toContain('+5521999999999')
  })

  it('formulário de página ignora UTMs e objetos', () => {
    const t = leadContextFrom({
      origem: 'landing',
      utm_source: 'meta',
      momento: 'Já me formei',
      extra: { a: 1 },
    })!
    expect(t).toContain('- Momento: Já me formei')
    expect(t).not.toContain('utm')
    expect(t).not.toContain('landing')
  })

  it('calculadora mantém o formato próprio', () => {
    expect(leadContextFrom({ origem: 'calculadora-vaga-aberta', cargo_vaga: 'SDR' })).toContain('Calculadora de Vaga Aberta')
  })

  it('sem nada útil não gera contexto', () => {
    expect(leadContextFrom({ leadgen_id: '1', utm_source: 'x' })).toBeUndefined()
    expect(leadContextFrom(null)).toBeUndefined()
  })
})
