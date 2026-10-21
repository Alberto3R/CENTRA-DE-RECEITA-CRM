/**
 * A Z-API guarda a mídia recebida por só 30 dias. Copiamos para o bucket do
 * chat (`chat-media`, mesmo caminho por conta das migrations 020/023) para o
 * histórico do cliente não perder foto, áudio e documento.
 *
 * Best-effort: se baixar ou subir falhar (ou passar do limite do bucket),
 * fica o link da própria Z-API — a mensagem nunca deixa de ser gravada.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'chat-media'
/** Limite do bucket (file_size_limit das migrations 016/020/023), igual a
 *  MEDIA_MAX_BYTES de lib/storage/upload-media — que é módulo de navegador. */
const MEDIA_MAX_BYTES = 16 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
}

export function mediaExtension(contentType: string | null, url: string): string {
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime]
  const file = url.split('?')[0].split('/').pop() ?? ''
  const fromUrl = file.includes('.') ? file.split('.').pop()?.toLowerCase() : null
  return fromUrl && /^[a-z0-9]{1,5}$/.test(fromUrl) ? fromUrl : 'bin'
}

export async function persistZapiMedia(args: {
  db: SupabaseClient
  accountId: string
  messageId: string
  url: string
}): Promise<string> {
  const { db, accountId, messageId, url } = args
  try {
    const res = await fetch(url)
    if (!res.ok) return url
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MEDIA_MAX_BYTES) return url
    const contentType = res.headers.get('content-type')
    const safeId = messageId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'midia'
    const path = `account-${accountId}/${Date.now()}-zapi-${safeId}.${mediaExtension(contentType, url)}`
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: contentType ?? undefined,
      upsert: false,
    })
    if (error) {
      console.warn('[zapi] cópia da mídia falhou:', error.message)
      return url
    }
    return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch (err) {
    console.warn('[zapi] cópia da mídia falhou:', err instanceof Error ? err.message : err)
    return url
  }
}
