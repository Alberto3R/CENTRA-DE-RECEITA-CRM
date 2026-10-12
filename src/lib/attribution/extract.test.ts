import { describe, expect, it } from 'vitest'
import { extractAttribution } from './extract'

describe('extractAttribution', () => {
  it('usa o que veio no corpo', () => {
    const a = extractAttribution({ utm_source: 'ig', utm_campaign: '120250613597990190', fbp: 'fb.1.x' })
    expect(a.utm_source).toBe('ig')
    expect(a.utm_campaign).toBe('120250613597990190')
    expect(a.fbp).toBe('fb.1.x')
  })

  it('cai para a query string da landing_url quando o corpo não traz UTM', () => {
    const a = extractAttribution({
      nome: 'Ana',
      landing_url: 'https://pos.exemplo.com/?utm_source=fb&utm_campaign=123&utm_content=456&fbclid=ABC',
    })
    expect(a.utm_source).toBe('fb')
    expect(a.utm_campaign).toBe('123')
    expect(a.utm_content).toBe('456')
    expect(a.fbclid).toBe('ABC')
  })

  it('o corpo vence a query string', () => {
    const a = extractAttribution({ utm_source: 'ig', landing_url: 'https://x.com/?utm_source=fb' })
    expect(a.utm_source).toBe('ig')
  })

  it('usa o Referer como último recurso', () => {
    const a = extractAttribution({ nome: 'Ana' }, 'https://x.com/lp?utm_campaign=999')
    expect(a.utm_campaign).toBe('999')
    expect(a.landing_url).toBe('https://x.com/lp?utm_campaign=999')
  })

  it('formulário só com nome/email/telefone e sem URL → tudo nulo, sem erro', () => {
    const a = extractAttribution({ nome: 'Ana', email: 'a@b.com', phone: '11999999999' })
    expect(a.utm_source).toBeNull()
    expect(a.landing_url).toBeNull()
  })

  it('URL inválida não quebra', () => {
    const a = extractAttribution({ landing_url: 'não é url' })
    expect(a.utm_source).toBeNull()
    expect(a.landing_url).toBe('não é url')
  })
})
