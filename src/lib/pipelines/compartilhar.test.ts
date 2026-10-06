import { describe, expect, it } from 'vitest'

import { lerEtapasCompartilhadas } from './compartilhar'

describe('lerEtapasCompartilhadas', () => {
  it('aceita o formato que o próprio CRM gera', () => {
    const r = lerEtapasCompartilhadas([
      { nome: 'Novo lead', funcao: 'entrada', dias_max: 1, toques: [{ dia: 0, canal: 'WhatsApp', acao: 'Responder' }], cor: '#3b82f6' },
    ])
    expect(r).toEqual([
      { nome: 'Novo lead', funcao: 'entrada', dias_max: 1, toques: [{ dia: 0, canal: 'WhatsApp', acao: 'Responder', mensagem: undefined }], cor: '#3b82f6' },
    ])
  })

  it('não confia no que veio do link: função, prazo, cor e tamanho são saneados', () => {
    const r = lerEtapasCompartilhadas([
      { nome: 'X', funcao: 'hackear', dias_max: -3, toques: 'lixo', cor: 'red; background:url(x)' },
      { nome: '   ' },
      null,
      ...Array.from({ length: 30 }, (_, i) => ({ nome: `E${i}`, funcao: 'tentativa' })),
    ])
    expect(r[0]).toMatchObject({ nome: 'X', funcao: 'qualificado', dias_max: null, toques: [] })
    expect(r[0].cor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(r.length).toBe(20)
  })

  it('devolve vazio para formato inválido', () => {
    expect(lerEtapasCompartilhadas({ nome: 'x' })).toEqual([])
    expect(lerEtapasCompartilhadas(null)).toEqual([])
  })
})
