import { describe, expect, it } from 'vitest'
import { leadsFromActions, syncWindow, toSpendRow } from './spend-sync'

describe('leadsFromActions', () => {
  it('prefere o agregado `lead`', () => {
    expect(
      leadsFromActions([
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '7' },
        { action_type: 'lead', value: '9' },
      ]),
    ).toBe(9)
  })
  it('cai para o pixel quando não há `lead`', () => {
    expect(leadsFromActions([{ action_type: 'offsite_conversion.fb_pixel_lead', value: '4' }])).toBe(4)
  })
  it('sem ações → 0', () => {
    expect(leadsFromActions(undefined)).toBe(0)
  })
})

describe('syncWindow', () => {
  const now = new Date('2026-10-12T12:00:00Z')
  it('primeira vez: 90 dias', () => {
    expect(syncWindow(null, now)).toEqual({ since: '2026-07-14', until: '2026-10-12' })
  })
  it('depois: últimos 3 dias', () => {
    expect(syncWindow('2026-10-11T00:00:00Z', now)).toEqual({ since: '2026-10-09', until: '2026-10-12' })
  })
})

describe('toSpendRow', () => {
  it('converte a linha de insights', () => {
    const r = toSpendRow(
      {
        date_start: '2026-10-01',
        ad_id: '120251196718770190',
        campaign_id: '120250613597990190',
        spend: '123.45',
        impressions: '1000',
        clicks: '20',
        account_currency: 'BRL',
        actions: [{ action_type: 'lead', value: '3' }],
      },
      { id: 'ad-uuid', account_id: 'acc-uuid' },
    )
    expect(r).toMatchObject({
      account_id: 'acc-uuid',
      ad_account_id: 'ad-uuid',
      date: '2026-10-01',
      spend: 123.45,
      impressions: 1000,
      clicks: 20,
      meta_leads: 3,
      currency: 'BRL',
    })
  })
})
