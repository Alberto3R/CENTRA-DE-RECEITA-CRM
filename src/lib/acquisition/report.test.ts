import { describe, expect, it } from 'vitest'
import { presetRange, resultOf, rowMetrics, totals, type AcquisitionReport } from './report'

const base: AcquisitionReport = {
  period: { from: '2026-09-01', to: '2026-09-30' },
  currency: 'BRL',
  settings: { attribution_model: 'first_touch', attribution_window_days: 90, margin_pct: null, commission_pct: null },
  channels: [
    { channel_id: 'meta', name: 'Meta Ads', kind: 'paid', position: 0, leads: 100, sales: 4, revenue: 20000, won_no_value: 1, spend: 5000, meta_leads: 180 },
    { channel_id: 'out', name: 'Prospecção', kind: 'outbound', position: 1, leads: 20, sales: 2, revenue: 8000, won_no_value: 0, spend: 0, meta_leads: 0 },
    { channel_id: null, name: 'Não identificado', kind: null, position: 999999, leads: 30, sales: 1, revenue: 2000, won_no_value: 0, spend: 0, meta_leads: 0 },
  ],
  campaigns: [],
  weekly: [],
  spend_currencies: ['BRL'],
  ad_accounts: [],
}

describe('rowMetrics', () => {
  it('calcula CPL, CAC, ROAS e conversão', () => {
    expect(rowMetrics({ leads: 100, sales: 4, revenue: 20000, spend: 5000 })).toEqual({
      cpl: 50,
      cac: 1250,
      roas: 4,
      conversion: 0.04,
    })
  })
  it('sem investimento o custo é desconhecido (null), não zero', () => {
    expect(rowMetrics({ leads: 20, sales: 2, revenue: 8000, spend: 0 })).toMatchObject({ cpl: null, cac: null, roas: null })
  })
  it('divisão por zero vira null, nunca Infinity', () => {
    expect(rowMetrics({ leads: 0, sales: 0, revenue: 0, spend: 300 })).toMatchObject({ cpl: null, cac: null, conversion: null })
  })
})

describe('resultOf', () => {
  it('margem não informada = 100%, sem comissão', () => {
    expect(resultOf(30000, 5000, { margin_pct: null, commission_pct: null })).toBe(25000)
  })
  it('aplica margem e comissão', () => {
    expect(resultOf(30000, 5000, { margin_pct: 70, commission_pct: 10 })).toBe(30000 * 0.7 - 3000 - 5000)
  })
})

describe('totals', () => {
  it('soma canais e separa o não identificado', () => {
    const t = totals(base)
    expect(t).toMatchObject({
      leads: 150,
      sales: 7,
      revenue: 30000,
      spend: 5000,
      wonNoValue: 1,
      unidentifiedLeads: 30,
      unidentifiedSales: 1,
      marginKnown: false,
      result: 25000,
    })
    expect(t.roas).toBe(6)
  })
})

describe('presetRange', () => {
  const now = new Date(2026, 9, 12)
  it('mês atual e mês passado', () => {
    expect(presetRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-12' })
    expect(presetRange('last_month', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })
  it('30 dias inclui hoje', () => {
    expect(presetRange('30', now)).toEqual({ from: '2026-09-13', to: '2026-10-12' })
  })
})
