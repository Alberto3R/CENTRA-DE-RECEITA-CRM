import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'

/** Tokens dos canais de WhatsApp da conta — primário primeiro, sem repetir. */
async function channelTokens(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
): Promise<string[]> {
  const primary = await resolveChannelConfig(supabase, accountId)
  const { data: others } = await supabase
    .from('whatsapp_config')
    .select('id, access_token')
    .eq('account_id', accountId)
    .eq('channel_type', 'whatsapp')
  const rows = [
    ...(primary?.channel_type === 'whatsapp' || !primary?.channel_type ? [primary] : []),
    ...((others ?? []) as { id: string; access_token: string | null }[]),
  ]
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const row of rows) {
    if (!row?.access_token || seen.has(row.id)) continue
    seen.add(row.id)
    try {
      tokens.push(decrypt(row.access_token))
    } catch {
      // token ilegível nesse canal — tenta o próximo
    }
  }
  return tokens
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Multi-canal: o media id só abre com o token da WABA que recebeu a
    // mídia. Com um único número isso é o primário; com coexistência cada
    // vendedor tem a SUA WABA. O link não diz o canal, então tenta o
    // primário (caminho comum) e depois os demais canais de WhatsApp.
    const tokens = await channelTokens(supabase, accountId)
    if (tokens.length === 0) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    let accessToken = ''
    let mediaInfo: Awaited<ReturnType<typeof getMediaUrl>> | null = null
    let lastError: unknown = null
    for (const token of tokens) {
      try {
        mediaInfo = await getMediaUrl({ mediaId, accessToken: token })
        accessToken = token
        break
      } catch (err) {
        lastError = err
      }
    }
    if (!mediaInfo) throw lastError

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
