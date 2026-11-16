import { describe, expect, it } from 'vitest'
import { parseAvailableCredit } from './calling'

describe('parseAvailableCredit', () => {
  it('lê o saldo negativo que travou as ligações em nov/2026', () => {
    expect(parseAvailableCredit({ data: { available_credit: '-2.03', balance: '-2.03' } })).toBe(-2.03)
  })

  it('lê saldo positivo e zero', () => {
    expect(parseAvailableCredit({ data: { available_credit: '10.00' } })).toBe(10)
    expect(parseAvailableCredit({ data: { available_credit: '0.00' } })).toBe(0)
  })

  it('aceita número além de texto', () => {
    expect(parseAvailableCredit({ data: { available_credit: 4.5 } })).toBe(4.5)
  })

  it('resposta estranha → null (não bloqueia a ligação)', () => {
    expect(parseAvailableCredit(null)).toBeNull()
    expect(parseAvailableCredit({})).toBeNull()
    expect(parseAvailableCredit({ errors: [{ code: '10005' }] })).toBeNull()
    expect(parseAvailableCredit({ data: { available_credit: 'abc' } })).toBeNull()
  })
})
