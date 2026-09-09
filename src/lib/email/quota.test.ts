import { describe, it, expect } from 'vitest'
import { inicioDoDiaBrasilISO, intervaloEntreEnvios } from './quota'

describe('inicioDoDiaBrasilISO', () => {
  it('devolve a meia-noite de São Paulo (03:00 UTC do mesmo dia)', () => {
    // 27/ago 14:00 UTC = 11:00 em SP → início do dia = 27/ago 03:00 UTC
    expect(inicioDoDiaBrasilISO(new Date('2026-08-27T14:00:00Z')))
      .toBe('2026-08-27T03:00:00.000Z')
  })

  it('de madrugada em UTC ainda pertence ao dia ANTERIOR no Brasil', () => {
    // 27/ago 01:00 UTC = 26/ago 22:00 em SP → o dia comercial é 26/ago
    expect(inicioDoDiaBrasilISO(new Date('2026-08-27T01:00:00Z')))
      .toBe('2026-08-26T03:00:00.000Z')
  })

  it('exatamente na virada do dia em SP começa o dia novo', () => {
    // 27/ago 03:00 UTC = 27/ago 00:00 em SP
    expect(inicioDoDiaBrasilISO(new Date('2026-08-27T03:00:00Z')))
      .toBe('2026-08-27T03:00:00.000Z')
  })
})

describe('intervaloEntreEnvios', () => {
  it('fica dentro da janela pedida', () => {
    for (let i = 0; i < 200; i++) {
      const ms = intervaloEntreEnvios(1000, 2000)
      expect(ms).toBeGreaterThanOrEqual(1000)
      expect(ms).toBeLessThan(2000)
    }
  })

  it('varia — rajada uniforme é assinatura de robô', () => {
    const amostras = new Set(Array.from({ length: 50 }, () => intervaloEntreEnvios()))
    expect(amostras.size).toBeGreaterThan(1)
  })

  it('o padrão espalha os envios em minutos, não segundos', () => {
    const ms = intervaloEntreEnvios()
    expect(ms).toBeGreaterThanOrEqual(45_000)
    expect(ms).toBeLessThan(180_000)
  })
})
