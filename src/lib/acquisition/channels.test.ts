import { describe, expect, it } from 'vitest'
import { classify, parseList, suggestedChannels, type AcquisitionChannel } from './channels'

const ch = (over: Partial<AcquisitionChannel>): AcquisitionChannel => ({
  id: over.name ?? 'x',
  account_id: 'a',
  name: 'x',
  kind: 'other',
  color: null,
  position: 0,
  match_sources: [],
  match_utm_sources: [],
  match_utm_mediums: [],
  match_pipeline_ids: [],
  ...over,
})

const canais = [
  ch({ name: 'Pago', position: 0, match_utm_sources: ['fb', 'ig'] }),
  ch({ name: 'WhatsApp', position: 1, match_sources: ['ctwa'] }),
  ch({ name: 'Prospecção', position: 2, match_pipeline_ids: ['funil-prospeccao'] }),
]

describe('classify', () => {
  it('casa por utm_source sem diferenciar caixa', () => {
    expect(classify(canais, { source: 'form', utm_source: 'IG', utm_medium: null })?.name).toBe('Pago')
  })

  it('casa por source', () => {
    expect(classify(canais, { source: 'ctwa', utm_source: null, utm_medium: null })?.name).toBe('WhatsApp')
  })

  it('negócio sem rastro digital cai pelo funil', () => {
    expect(classify(canais, null, 'funil-prospeccao')?.name).toBe('Prospecção')
  })

  it('o primeiro canal por position vence', () => {
    const ambos = [
      ch({ name: 'B', position: 5, match_sources: ['form'] }),
      ch({ name: 'A', position: 1, match_sources: ['form'] }),
    ]
    expect(classify(ambos, { source: 'form', utm_source: null, utm_medium: null })?.name).toBe('A')
  })

  it('nada bate → null (Não identificado)', () => {
    expect(classify(canais, { source: 'form', utm_source: null, utm_medium: null })).toBeNull()
    expect(classify(canais, null, null)).toBeNull()
  })
})

describe('suggestedChannels', () => {
  it('o form do leadgen (utm_medium=leadform) e o ctwa caem em canais pagos', () => {
    const s = suggestedChannels().map((c, i) => ch({ ...c, id: String(i) }))
    expect(classify(s, { source: 'meta-leadform-vsc', utm_source: 'facebook', utm_medium: 'leadform' })?.kind).toBe('paid')
    expect(classify(s, { source: 'ctwa', utm_source: 'facebook', utm_medium: 'ctwa' })?.kind).toBe('paid')
    expect(classify(s, { source: 'whatsapp-post', utm_source: null, utm_medium: 'organic' })?.kind).toBe('organic')
  })
})

describe('parseList', () => {
  it('limpa espaços, vazios e repetidos', () => {
    expect(parseList(' fb, ig ,, fb ')).toEqual(['fb', 'ig'])
  })
})
