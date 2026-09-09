import { describe, it, expect, vi } from 'vitest'

// A criptografia real exige ENCRYPTION_KEY no ambiente; aqui só interessa que
// a senha passe pelo decrypt, não COMO ela é decifrada.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `decifrado:${v}`,
}))

const { isEmailChannel, toEmailChannel, DEFAULT_DAILY_SEND_LIMIT } = await import('./config')

const canalBase = {
  id: 'ch-1',
  account_id: 'acc-1',
  channel_type: 'email',
  email_address: 'acramos@time.sales3r.com.br',
  access_token: 'cifrado',
  label: 'Prospecção',
}

describe('isEmailChannel', () => {
  it('reconhece canal de e-mail', () => {
    expect(isEmailChannel(canalBase)).toBe(true)
  })
  it('não confunde com os outros canais', () => {
    expect(isEmailChannel({ channel_type: 'whatsapp' })).toBe(false)
    expect(isEmailChannel({ channel_type: 'instagram' })).toBe(false)
    expect(isEmailChannel(null)).toBe(false)
    expect(isEmailChannel(undefined)).toBe(false)
  })
})

describe('toEmailChannel', () => {
  it('aplica os padrões do Zoho quando host/porta não vêm preenchidos', () => {
    const c = toEmailChannel(canalBase)
    expect(c.smtpHost).toBe('smtp.zoho.com')
    expect(c.smtpPort).toBe(465)
    expect(c.imapHost).toBe('imap.zoho.com')
    expect(c.imapPort).toBe(993)
    expect(c.provider).toBe('zoho')
  })

  it('respeita host/porta explícitos em vez do padrão', () => {
    const c = toEmailChannel({
      ...canalBase,
      smtp_host: 'smtp.custom.com',
      smtp_port: 587,
      imap_host: 'imap.custom.com',
      imap_port: 143,
    })
    expect(c.smtpHost).toBe('smtp.custom.com')
    expect(c.smtpPort).toBe(587)
    expect(c.imapHost).toBe('imap.custom.com')
    expect(c.imapPort).toBe(143)
  })

  it('cai no Zoho quando o provedor é desconhecido', () => {
    const c = toEmailChannel({ ...canalBase, email_provider: 'provedor-que-nao-existe' })
    expect(c.smtpHost).toBe('smtp.zoho.com')
  })

  it('usa os padrões do Google quando o provedor é google', () => {
    const c = toEmailChannel({ ...canalBase, email_provider: 'google' })
    expect(c.smtpHost).toBe('smtp.gmail.com')
    expect(c.imapHost).toBe('imap.gmail.com')
  })

  it('decifra a senha', () => {
    expect(toEmailChannel(canalBase).password).toBe('decifrado:cifrado')
  })

  it('aplica o teto diário padrão quando o canal não define', () => {
    expect(toEmailChannel(canalBase).dailySendLimit).toBe(DEFAULT_DAILY_SEND_LIMIT)
  })

  it('respeita o teto diário do canal', () => {
    expect(toEmailChannel({ ...canalBase, daily_send_limit: 15 }).dailySendLimit).toBe(15)
  })

  it('recusa canal que não é de e-mail', () => {
    expect(() => toEmailChannel({ ...canalBase, channel_type: 'whatsapp' })).toThrow(/não é do tipo email/)
  })

  it('recusa canal de e-mail sem caixa', () => {
    expect(() => toEmailChannel({ ...canalBase, email_address: null })).toThrow(/sem email_address/)
  })

  it('recusa canal sem credencial', () => {
    expect(() => toEmailChannel({ ...canalBase, access_token: null })).toThrow(/sem credencial/)
  })
})
