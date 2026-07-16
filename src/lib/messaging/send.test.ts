import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock só as camadas de rede (senders da Meta) + decrypt. phone-utils é real
// (queremos exercitar sanitização/variantes de verdade).
const waSend = vi.fn(async () => ({ messageId: 'wa-1' }))
const igPageToken = vi.fn(async () => 'PAGE_TOKEN')
const igSend = vi.fn(async () => ({ messageId: 'ig-1' }))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (a: unknown) => waSend(a),
}))
vi.mock('@/lib/instagram/meta-api', () => ({
  getInstagramPageToken: (a: unknown) => igPageToken(a),
  sendInstagramText: (a: unknown) => igSend(a),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => `dec:${s}`,
}))

import { sendTextViaChannel, isInstagramChannel } from './send'

beforeEach(() => {
  waSend.mockClear()
  igPageToken.mockClear()
  igSend.mockClear()
})

describe('isInstagramChannel', () => {
  it('true só para channel_type=instagram', () => {
    expect(isInstagramChannel({ channel_type: 'instagram' })).toBe(true)
    expect(isInstagramChannel({ channel_type: 'whatsapp' })).toBe(false)
    expect(isInstagramChannel(null)).toBe(false)
    expect(isInstagramChannel(undefined)).toBe(false)
  })
})

describe('sendTextViaChannel', () => {
  it('roteia Instagram pelo Messenger Platform (page token + IGSID)', async () => {
    const channel = { channel_type: 'instagram', ig_page_id: 'PAGE', access_token: 'enc' }
    const r = await sendTextViaChannel({
      channel,
      contact: { instagram_id: 'IGSID' },
      text: 'oi',
    })
    expect(r.providerMessageId).toBe('ig-1')
    expect(igPageToken).toHaveBeenCalledWith({ pageId: 'PAGE', systemUserToken: 'dec:enc' })
    expect(igSend).toHaveBeenCalledWith({
      pageId: 'PAGE',
      pageToken: 'PAGE_TOKEN',
      igsid: 'IGSID',
      text: 'oi',
    })
    expect(waSend).not.toHaveBeenCalled()
  })

  it('Instagram sem instagram_id → erro (não envia pro canal errado)', async () => {
    const channel = { channel_type: 'instagram', ig_page_id: 'PAGE', access_token: 'enc' }
    await expect(
      sendTextViaChannel({ channel, contact: {}, text: 'oi' }),
    ).rejects.toThrow(/instagram_id/)
    expect(igSend).not.toHaveBeenCalled()
  })

  it('roteia WhatsApp pela Cloud API (phone_number_id + telefone)', async () => {
    const channel = { channel_type: 'whatsapp', phone_number_id: 'PNID', access_token: 'enc' }
    const r = await sendTextViaChannel({
      channel,
      contact: { phone: '+55 61 99999-9999' },
      text: 'oi',
    })
    expect(r.providerMessageId).toBe('wa-1')
    expect(waSend).toHaveBeenCalledTimes(1)
    expect(igSend).not.toHaveBeenCalled()
    // workingPhone é preenchido no WhatsApp (variante que funcionou)
    expect(r.workingPhone).toBeTruthy()
  })

  it('canal null → erro', async () => {
    await expect(
      sendTextViaChannel({ channel: null, contact: {}, text: 'x' }),
    ).rejects.toThrow()
  })
})
