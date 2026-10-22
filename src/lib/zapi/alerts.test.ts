import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)

const sendTemplate = vi.fn(async () => ({ messageId: 'wamid.alerta' }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTemplateMessage: sendTemplate }))

const { encrypt } = await import('@/lib/whatsapp/encryption')
const {
  avisar,
  avisoDeTeste,
  registrarConexao,
  registrarQueda,
  telefoneDoResponsavel,
  textoQueda,
  DESCONEXAO_MANUAL,
} = await import('./alerts')

// Banco falso mínimo: só o que alerts.ts usa (select/eq/limit/maybeSingle/update).
type Row = Record<string, unknown>
let db: Record<string, Row[]>
function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let patch: Row | null = null
      const rows = () => (db[table] ??= [])
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        limit: () => q,
        update: (p: Row) => ((patch = p), q),
        maybeSingle: () => q,
        then: (ok: (v: unknown) => unknown) => {
          const hit = rows().filter((r) => filters.every((f) => f(r)))
          if (patch) for (const r of hit) Object.assign(r, patch)
          // Como o PostgREST: devolve cópia, não a linha do banco.
          return Promise.resolve({ data: patch ? null : hit[0] ? { ...hit[0] } : null, error: null }).then(ok)
        },
      }
      return q
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'dono@loja.com.br' } } }),
      },
    },
  } as never
}

const canal = (extra: Row = {}): Row => ({
  id: 'ch-qr',
  account_id: 'acc-1',
  label: 'WhatsApp da loja',
  display_phone_number: '+55 31 8413-7617',
  status: 'connected',
  alert_phone: '5531997729804',
  alert_email: null,
  qr_alerted_at: null,
  qr_last_error: null,
  qr_instance_id: 'INST',
  access_token: encrypt('tok'),
  qr_client_token: encrypt('ct'),
  ...extra,
})

const resend = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
  async () => new Response('{"id":"r1"}'),
)
let zapiConectado = false

beforeEach(() => {
  db = {
    whatsapp_config: [
      canal(),
      { id: 'ch-3r', phone_number_id: 'PN-3R', access_token: encrypt('tok-3r'), status: 'connected' },
    ],
    message_templates: [{ name: 'ccc_alerta_gestor', status: 'APPROVED', channel_id: 'ch-3r' }],
    app_config: [
      { key: 'alert_resend_api_key', value: 're_x' },
      { key: 'alert_email_to', value: 'ops@3r.com.br' },
    ],
    accounts: [{ id: 'acc-1', name: 'MA Decorações', owner_user_id: 'u-1' }],
  }
  sendTemplate.mockClear()
  resend.mockClear()
  zapiConectado = false
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('z-api.io')) {
      return new Response(JSON.stringify({ connected: zapiConectado }))
    }
    return resend(url, init)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('textos e telefone', () => {
  it('o texto do aviso é uma linha só (a Meta recusa quebra de linha na variável)', () => {
    const t = textoQueda({
      conta: 'MA Decorações',
      canal: { label: 'WhatsApp da loja', display_phone_number: '+55 31 8413-7617' },
      quando: new Date('2026-10-22T14:10:16Z'),
    })
    expect(t).not.toMatch(/[\n\t]| {5,}/)
    expect(t).toContain('WhatsApp da loja (+55 31 8413-7617)')
    expect(t).toContain('22/10, 11:10')
  })

  it('telefone do responsável vira o formato da Meta', () => {
    expect(telefoneDoResponsavel('+55 31 99772-9804')).toBe('5531997729804')
    expect(telefoneDoResponsavel('31 99772-9804')).toBe('5531997729804')
    expect(telefoneDoResponsavel('')).toBeNull()
    expect(telefoneDoResponsavel('abc')).toBeNull()
  })
})

describe('avisar', () => {
  it('WhatsApp pelo número da 3R com o modelo aprovado + e-mail ao dono com cópia para a 3R', async () => {
    const r = await avisar(fakeDb(), canal() as never, 'queda', new Date('2026-10-22T14:10:16Z'))
    expect(r).toEqual({ whatsapp: true, email: true })
    expect(sendTemplate).toHaveBeenCalledTimes(1)
    const args = (sendTemplate.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(args).toMatchObject({
      phoneNumberId: 'PN-3R',
      accessToken: 'tok-3r',
      to: '5531997729804',
      templateName: 'ccc_alerta_gestor',
      language: 'pt_BR',
    })
    expect((args.params as string[])[0]).toContain('desconectou')
    const body = JSON.parse((resend.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.to).toEqual(['dono@loja.com.br', 'ops@3r.com.br'])
    expect(body.subject).toContain('WhatsApp desconectado')
  })

  it('e-mail do responsável no canal tem prioridade sobre o do dono', async () => {
    await avisar(fakeDb(), canal({ alert_email: 'thais@loja.com.br' }) as never, 'queda')
    const body = JSON.parse((resend.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.to).toEqual(['thais@loja.com.br', 'ops@3r.com.br'])
  })

  it('teste vai só para o responsável, sem cópia para a 3R', async () => {
    const r = await avisoDeTeste(fakeDb(), 'ch-qr')
    expect(r).toEqual({ whatsapp: true, email: true })
    const body = JSON.parse((resend.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.to).toEqual(['dono@loja.com.br'])
  })
})

describe('registrarQueda / registrarConexao', () => {
  it('queda nova: marca, confere na Z-API, avisa uma vez só', async () => {
    expect(await registrarQueda(fakeDb(), 'ch-qr', 'Device has been disconnected', { esperaMs: 0 })).toBe('avisado')
    const ch = db.whatsapp_config[0]
    expect(ch).toMatchObject({ status: 'disconnected', qr_last_error: 'Device has been disconnected' })
    expect(ch.qr_alerted_at).toBeTruthy()
    expect(sendTemplate).toHaveBeenCalledTimes(1)

    // A Z-API repete o evento enquanto tenta voltar: sem segundo aviso.
    expect(await registrarQueda(fakeDb(), 'ch-qr', 'outra coisa', { esperaMs: 0 })).toBe('ja_avisado')
    expect(sendTemplate).toHaveBeenCalledTimes(1)
    expect(ch.qr_last_error).toBe('Device has been disconnected')
  })

  it('caiu e voltou sozinho em segundos: não avisa', async () => {
    zapiConectado = true
    expect(await registrarQueda(fakeDb(), 'ch-qr', 'restart', { esperaMs: 0 })).toBe('voltou_sozinho')
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('reconectou depois do aviso: zera e avisa que voltou', async () => {
    await registrarQueda(fakeDb(), 'ch-qr', 'caiu', { esperaMs: 0 })
    sendTemplate.mockClear()
    await registrarConexao(fakeDb(), 'ch-qr', '+55 31 8413-7617')
    const ch = db.whatsapp_config[0]
    expect(ch).toMatchObject({ status: 'connected', qr_alerted_at: null, qr_last_error: null })
    expect(sendTemplate).toHaveBeenCalledTimes(1)
    expect(((sendTemplate.mock.calls[0] as unknown[])[0] as { params: string[] }).params[0]).toContain('voltou')
  })

  it('desconectado de propósito pela Central: nem aviso de queda, nem de volta', async () => {
    Object.assign(db.whatsapp_config[0], {
      status: 'disconnected',
      qr_alerted_at: new Date().toISOString(),
      qr_last_error: `${DESCONEXAO_MANUAL} em 22/10/2026`,
    })
    expect(await registrarQueda(fakeDb(), 'ch-qr', 'Device has been disconnected', { esperaMs: 0 })).toBe('ja_avisado')
    await registrarConexao(fakeDb(), 'ch-qr', null)
    expect(sendTemplate).not.toHaveBeenCalled()
  })
})
