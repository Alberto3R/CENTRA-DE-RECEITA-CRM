import { describe, expect, it } from 'vitest'
import { lerAvaliacao, normalizarOrigem, segmentar, type MensagemConversa } from './avaliar'
import { parseFinalComFerramentas } from './respond'

const m = (sender_type: string, min: number, content_text: string | null = 'x'): MensagemConversa => ({
  sender_type,
  content_text,
  template_name: null,
  created_at: new Date(Date.UTC(2026, 9, 2, 17, min, 0)).toISOString(),
})

describe('segmentar', () => {
  it('corta no 1º humano depois do lead e mede a 1ª resposta', () => {
    const t = segmentar([
      m('customer', 0, 'Quero o conteúdo da Palestra e saber mais sobre o ADT.'),
      m('bot', 1),
      m('customer', 3),
      m('bot', 4),
      m('agent', 40),
      m('customer', 41),
    ])!
    expect(t.mensagens).toHaveLength(4)
    expect(t.leadRespondeu).toBe(true)
    expect(t.respostaSeg).toBe(60)
    expect(t.humanoAssumiuAt).not.toBeNull()
    expect(t.msgsLead).toBe(3)
    expect(t.msgsHumano).toBe(1)
    expect(t.origem).toBe('quero o conteúdo da palestra e saber mais sobre')
  })

  it('humano que entra antes do lead responder não conta como resposta', () => {
    const t = segmentar([m('customer', 0), m('bot', 1), m('agent', 30), m('customer', 31)])!
    expect(t.leadRespondeu).toBe(false)
  })

  it('mensagem do time antes do lead (disparo) não corta o trecho', () => {
    const t = segmentar([m('agent', 0), m('customer', 5), m('bot', 6)])!
    expect(t.humanoAssumiuAt).toBeNull()
    expect(t.mensagens).toHaveLength(3)
  })

  it('sem mensagem do lead não há atendimento', () => {
    expect(segmentar([m('bot', 0)])).toBeNull()
  })
})

describe('normalizarOrigem', () => {
  it('ignora caixa e espaços', () => {
    expect(normalizarOrigem('  Quero   o CONTEÚDO')).toBe('quero o conteúdo')
  })
})

describe('lerAvaliacao', () => {
  const campos = [
    { chave: 'momento', rotulo: 'Momento', opcoes: ['estudante', 'formado'] },
    { chave: 'periodo', rotulo: 'Período' },
  ]
  it('lê o JSON mesmo com texto em volta e só guarda os campos definidos', () => {
    const a = lerAvaliacao(
      'Segue: {"qualificacao":{"momento":"Estudante","periodo":7,"extra":"x"},"qualificado":true,"nota":4,"interesse":"alto","erro":""}',
      campos,
    )!
    expect(a.qualificacao).toEqual({ momento: 'estudante', periodo: 7 })
    expect(a.qualificado).toBe(true)
    expect(a.nota).toBe(4)
  })
  it('nota fora da escala e interesse inválido viram neutros', () => {
    const a = lerAvaliacao('{"nota":9,"interesse":"talvez"}', campos)!
    expect(a.nota).toBe(3)
    expect(a.interesse).toBe('sem_sinal')
    expect(a.qualificacao).toEqual({ momento: null, periodo: null })
  })
  it('sem JSON devolve null', () => {
    expect(lerAvaliacao('não sei', campos)).toBeNull()
  })
})

describe('parseFinalComFerramentas', () => {
  it('extrai o JSON depois de uma frase e preserva o handoff', () => {
    const r = parseFinalComFerramentas('Pronto, marquei.\n{"reply":"Tá marcado!","handoff":true,"intencao":"quer_fechar"}')
    expect(r.reply).toBe('Tá marcado!')
    expect(r.handoff).toBe(true)
  })
  it('texto puro segue como resposta', () => {
    expect(parseFinalComFerramentas('Oi, tudo bem?').reply).toBe('Oi, tudo bem?')
  })
})
