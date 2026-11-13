import { describe, expect, it } from 'vitest'
import { adCardFromAttribution, adMediaUrlFromReferral } from './ad-referral'

describe('adMediaUrlFromReferral', () => {
  it('Cloud API: prefere a imagem do criativo à miniatura', () => {
    expect(adMediaUrlFromReferral({ image_url: 'https://img', thumbnail_url: 'https://thumb' })).toBe('https://img')
  })
  it('vídeo ou Z-API: usa a miniatura, nunca o vídeo', () => {
    expect(adMediaUrlFromReferral({ video_url: 'https://mp4', thumbnail_url: 'https://thumb' })).toBe('https://thumb')
  })
  it('sem imagem nenhuma (ou vazia) → null', () => {
    expect(adMediaUrlFromReferral({ headline: 'x', image_url: '  ' })).toBeNull()
    expect(adMediaUrlFromReferral(null)).toBeNull()
  })
})

describe('adCardFromAttribution', () => {
  it('lead de anúncio vira cartão com a cópia permanente da imagem', () => {
    const card = adCardFromAttribution({
      source: 'ctwa',
      ad_id: '120254290267120360',
      landing_url: 'https://fb.me/x',
      raw: {
        headline: 'Converse conosco',
        body: 'Sofá retrátil',
        source_url: 'https://www.instagram.com/p/DanuBy9gEDN/',
        thumbnail_url: 'https://pps.whatsapp.net/expira',
        ad_image_url: 'https://bucket/anuncio.jpg',
        media_type: 'IMAGE',
      },
    })
    expect(card).toEqual({
      imageUrl: 'https://bucket/anuncio.jpg',
      isVideo: false,
      headline: 'Converse conosco',
      body: 'Sofá retrátil',
      url: 'https://www.instagram.com/p/DanuBy9gEDN/',
      isPost: false,
      adId: '120254290267120360',
    })
  })

  it('lead antigo (sem imagem gravada) ainda mostra título e link; texto " " vira null', () => {
    const card = adCardFromAttribution({
      source: 'ctwa',
      landing_url: 'https://fb.me/6kBklEUFf',
      raw: { headline: 'Converse conosco', body: ' ', source_id: '237' },
    })
    expect(card).toMatchObject({ imageUrl: null, body: null, url: 'https://fb.me/6kBklEUFf', adId: '237' })
  })

  it('vídeo é marcado como vídeo', () => {
    expect(adCardFromAttribution({ source: 'ctwa', raw: { media_type: 'VIDEO' } })?.isVideo).toBe(true)
    expect(adCardFromAttribution({ source: 'ctwa', raw: { video_url: 'https://mp4' } })?.isVideo).toBe(true)
  })

  it('post orgânico com botão de WhatsApp é marcado como post', () => {
    expect(adCardFromAttribution({ source: 'whatsapp-post', raw: {} })?.isPost).toBe(true)
  })

  it('origem que não é anúncio/post (formulário, SEO) → null', () => {
    expect(adCardFromAttribution({ source: 'form', raw: {} })).toBeNull()
    expect(adCardFromAttribution({ source: null })).toBeNull()
  })
})
