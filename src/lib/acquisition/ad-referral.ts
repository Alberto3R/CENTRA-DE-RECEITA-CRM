// O anúncio de onde o lead veio (Click-to-WhatsApp ou post com botão de
// WhatsApp), pronto para mostrar na conversa.
//
// Quem chega pelo anúncio manda a 1ª mensagem com o "referral" do criativo:
// título, texto, link do post e a imagem. Sem isso o vendedor não sabe qual
// produto o cliente viu — e no CRM, fora do celular, não havia como saber.
//
// O referral vem de dois lugares com nomes diferentes:
//   • Cloud API (Meta): image_url, video_url, thumbnail_url, media_type
//   • Z-API (QR):       thumbnail_url, media_type (vindos de externalAdReply)
// O webhook grava tudo em `lead_attribution.raw` e acrescenta `ad_image_url`,
// a cópia permanente da imagem no bucket do chat (os links da Meta expiram).

/** Campos do referral que importam aqui (o resto do raw é ignorado). */
export interface AdReferralRaw {
  source_url?: string | null
  source_id?: string | null
  source_type?: string | null
  headline?: string | null
  body?: string | null
  media_type?: string | null
  image_url?: string | null
  video_url?: string | null
  thumbnail_url?: string | null
  ad_image_url?: string | null
}

export interface AdCard {
  /** Imagem do criativo (cópia permanente quando houve; senão o link original). */
  imageUrl: string | null
  /** O criativo é vídeo — a imagem, quando há, é só a capa. */
  isVideo: boolean
  headline: string | null
  body: string | null
  /** Link do post/anúncio (abre com a foto no Instagram/Facebook). */
  url: string | null
  /** true = post orgânico com botão de WhatsApp; false = anúncio pago. */
  isPost: boolean
  adId: string | null
}

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/**
 * Link da imagem a copiar para o bucket na chegada do lead. Imagem do
 * criativo primeiro; num vídeo, a miniatura (capa) — nunca o vídeo em si.
 */
export function adMediaUrlFromReferral(ref: AdReferralRaw | null | undefined): string | null {
  if (!ref) return null
  return clean(ref.image_url) ?? clean(ref.thumbnail_url)
}

/**
 * Monta o cartão a partir de uma linha de `lead_attribution`. Devolve `null`
 * quando a origem não é anúncio/post de WhatsApp (formulário, SEO…).
 */
export function adCardFromAttribution(row: {
  source: string | null
  ad_id?: string | null
  landing_url?: string | null
  raw?: unknown
}): AdCard | null {
  if (row.source !== 'ctwa' && row.source !== 'whatsapp-post') return null
  const raw = (row.raw && typeof row.raw === 'object' ? row.raw : {}) as AdReferralRaw
  const mediaType = (clean(raw.media_type) ?? '').toLowerCase()
  return {
    imageUrl: clean(raw.ad_image_url) ?? adMediaUrlFromReferral(raw),
    isVideo: mediaType === 'video' || !!clean(raw.video_url),
    headline: clean(raw.headline),
    body: clean(raw.body),
    url: clean(raw.source_url) ?? clean(row.landing_url),
    isPost: row.source === 'whatsapp-post',
    adId: clean(row.ad_id) ?? clean(raw.source_id),
  }
}
