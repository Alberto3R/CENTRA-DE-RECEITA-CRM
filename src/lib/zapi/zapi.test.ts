import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)

const { formatConnectedPhone, mapZapiStatus, parseZapiReceived } = await import('./callback')
const { documentExtension } = await import('./client')
const { mediaExtension } = await import('./media')
const { encrypt } = await import('@/lib/whatsapp/encryption')
const { sendTextViaChannel, isQrChannel } = await import('@/lib/messaging/send')

const base = {
  type: 'ReceivedCallback' as const,
  messageId: 'M1',
  phone: '5531997729804',
  fromMe: false,
  momment: 1700000000000,
  senderName: 'Thais',
}

describe('parseZapiReceived', () => {
  it('texto: telefone em dígitos, timestamp em segundos', () => {
    const m = parseZapiReceived({ ...base, text: { message: 'oi' } })
    expect(m).toMatchObject({ id: 'M1', phone: '5531997729804', lid: null, name: 'Thais', type: 'text', contentText: 'oi', timestamp: '1700000000' })
  })

  it('imagem e documento trazem o link e a legenda/nome', () => {
    expect(parseZapiReceived({ ...base, image: { imageUrl: 'https://img', caption: 'sofá' } }))
      .toMatchObject({ type: 'image', mediaUrl: 'https://img', contentText: 'sofá' })
    expect(parseZapiReceived({ ...base, document: { documentUrl: 'https://doc', fileName: 'orcamento.pdf' } }))
      .toMatchObject({ type: 'document', mediaUrl: 'https://doc', contentText: 'orcamento.pdf' })
  })

  it('resposta de botão e de lista viram interactive com o id', () => {
    expect(parseZapiReceived({ ...base, buttonsResponseMessage: { buttonId: 'sim', message: 'Sim' } }))
      .toMatchObject({ type: 'interactive', contentText: 'Sim', interactiveReplyId: 'sim' })
    expect(parseZapiReceived({ ...base, listResponseMessage: { selectedRowId: 'r2', title: 'Sala' } }))
      .toMatchObject({ type: 'interactive', contentText: 'Sala', interactiveReplyId: 'r2' })
  })

  it('reação aponta para a mensagem reagida', () => {
    expect(parseZapiReceived({ ...base, reaction: { value: '❤️', referencedMessage: { messageId: 'X9' } } }))
      .toMatchObject({ type: 'reaction', reaction: { emoji: '❤️', targetId: 'X9' } })
  })

  it('lead de anúncio Click-to-WhatsApp vira referral com ctwa_clid', () => {
    const m = parseZapiReceived({
      ...base,
      text: { message: 'vi o anúncio' },
      externalAdReply: { sourceType: 'ad', sourceId: '237', ctwaClid: 'CLID', sourceUrl: 'https://fb' },
    })
    expect(m?.referral).toEqual({ source_type: 'ad', source_id: '237', ctwa_clid: 'CLID', source_url: 'https://fb', headline: undefined, body: undefined })
  })

  it('resposta citada guarda o id da mensagem original', () => {
    expect(parseZapiReceived({ ...base, referenceMessageId: 'ORIG', text: { message: 'esse' } })?.replyToId).toBe('ORIG')
  })

  it('enviada pelo celular: fromPhone e sem nome do cliente', () => {
    expect(parseZapiReceived({ ...base, fromMe: true, text: { message: 'tenho' } }))
      .toMatchObject({ fromPhone: true, name: '' })
  })

  it('ignora o que não é conversa 1:1', () => {
    expect(parseZapiReceived({ ...base, isGroup: true, text: { message: 'x' } })).toBeNull()
    expect(parseZapiReceived({ ...base, isNewsletter: true })).toBeNull()
    expect(parseZapiReceived({ ...base, broadcast: true })).toBeNull()
    expect(parseZapiReceived({ ...base, isStatusReply: true })).toBeNull()
    expect(parseZapiReceived({ ...base, notification: 'CALL_MISSED' })).toBeNull()
    expect(parseZapiReceived({ ...base, waitingMessage: true })).toBeNull()
    expect(parseZapiReceived({ ...base, fromMe: true, fromApi: true })).toBeNull()
    expect(parseZapiReceived({ ...base, messageId: undefined })).toBeNull()
  })

  it('Status (stories), grupo sem isGroup, canal e lista de transmissão são ignorados', () => {
    // Era isto que abria um contato sem telefone por mensagem (Eliene, Manu…).
    expect(parseZapiReceived({ ...base, phone: 'status@broadcast', text: { message: 'URGENTE' } })).toBeNull()
    expect(parseZapiReceived({ ...base, phone: '120363019502650977-group', text: { message: 'x' } })).toBeNull()
    expect(parseZapiReceived({ ...base, phone: '120363019502650977@g.us', text: { message: 'x' } })).toBeNull()
    expect(parseZapiReceived({ ...base, phone: '5531999999999@newsletter', text: { message: 'x' } })).toBeNull()
    expect(parseZapiReceived({ ...base, phone: '1774895799-broadcast', text: { message: 'x' } })).toBeNull()
    expect(parseZapiReceived({ ...base, participantPhone: '5531988887777', text: { message: 'x' } })).toBeNull()
    expect(parseZapiReceived({ ...base, phone: '', text: { message: 'x' } })).toBeNull()
  })

  it('telefone e LID: os dois quando vêm', () => {
    expect(parseZapiReceived({ ...base, chatLid: '171459523662078@lid', text: { message: 'oi' } }))
      .toMatchObject({ phone: '5531997729804', lid: '171459523662078@lid' })
    expect(parseZapiReceived({ ...base, senderLid: '171459523662078@lid', text: { message: 'oi' } }))
      .toMatchObject({ phone: '5531997729804', lid: '171459523662078@lid' })
  })

  it('só LID: o LID nunca vira telefone', () => {
    expect(parseZapiReceived({ ...base, phone: '81896604192873@lid', text: { message: 'oi' } }))
      .toMatchObject({ phone: null, lid: '81896604192873@lid' })
  })

  it('eco (fromMe): o senderLid é do vendedor, não do cliente', () => {
    expect(parseZapiReceived({ ...base, fromMe: true, senderLid: '999@lid', chatName: 'Michelle', text: { message: 'r$11.480' } }))
      .toMatchObject({ phone: '5531997729804', lid: null, name: '', chatName: 'Michelle' })
    expect(parseZapiReceived({ ...base, fromMe: true, phone: '171459523662078@lid', senderLid: '999@lid', text: { message: 'x' } }))
      .toMatchObject({ phone: null, lid: '171459523662078@lid' })
  })
})

describe('mapZapiStatus / formatConnectedPhone', () => {
  it('traduz o status para o vocabulário da Cloud API', () => {
    expect(mapZapiStatus('SENT')).toBe('sent')
    expect(mapZapiStatus('RECEIVED')).toBe('delivered')
    expect(mapZapiStatus('READ')).toBe('read')
    expect(mapZapiStatus('PLAYED')).toBe('read')
    expect(mapZapiStatus('READ_BY_ME')).toBeNull()
  })
  it('formata o número conectado', () => {
    expect(formatConnectedPhone('5531997729804')).toBe('+55 31 99772-9804')
    expect(formatConnectedPhone('14155550100')).toBe('+14155550100')
    expect(formatConnectedPhone('')).toBeNull()
  })
})

describe('extensões de arquivo', () => {
  it('documento: pelo nome, senão pelo link, senão pdf', () => {
    expect(documentExtension('orcamento.XLSX', null)).toBe('xlsx')
    expect(documentExtension(null, 'https://s/arq.docx?x=1')).toBe('docx')
    expect(documentExtension('sem-extensao', null)).toBe('pdf')
  })
  it('mídia copiada: pelo content-type, senão pelo link', () => {
    expect(mediaExtension('audio/ogg; codecs=opus', 'https://x/a')).toBe('ogg')
    expect(mediaExtension(null, 'https://x/foto.jpeg?t=1')).toBe('jpeg')
    expect(mediaExtension(null, 'https://x/sem')).toBe('bin')
  })
})

describe('envio de texto pelo canal QR', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sai pela instância da Z-API com o Client-Token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ zaapId: 'z', messageId: 'ZID', id: 'ZID' })))
    vi.stubGlobal('fetch', fetchMock)
    const channel = {
      connection_mode: 'qr',
      status: 'connected',
      qr_instance_id: 'INST',
      access_token: encrypt('TOK'),
      qr_client_token: encrypt('CT'),
    }
    expect(isQrChannel(channel)).toBe(true)
    const r = await sendTextViaChannel({ channel, contact: { phone: '5531997729804' }, text: 'olá' })
    expect(r.providerMessageId).toBe('ZID')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.z-api.io/instances/INST/token/TOK/send-text')
    expect((init.headers as Record<string, string>)['Client-Token']).toBe('CT')
    expect(JSON.parse(init.body as string)).toEqual({ phone: '5531997729804', message: 'olá' })
  })

  it('erro da Z-API vira exceção com a mensagem dela', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'You are not connected.' }), { status: 400 })))
    const channel = { connection_mode: 'qr', status: 'connected', qr_instance_id: 'INST', access_token: encrypt('TOK'), qr_client_token: encrypt('CT') }
    await expect(sendTextViaChannel({ channel, contact: { phone: '5531997729804' }, text: 'x' }))
      .rejects.toThrow('You are not connected.')
  })

  it('canal desconectado: nem chama a Z-API (mensagem iria para a fila)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const channel = { connection_mode: 'qr', status: 'disconnected', qr_instance_id: 'INST', access_token: encrypt('TOK'), qr_client_token: encrypt('CT') }
    await expect(sendTextViaChannel({ channel, contact: { phone: '5531997729804' }, text: 'x' }))
      .rejects.toThrow('desconectado')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
