/**
 * Configuração do canal de e-mail (migration 091).
 *
 * O canal mora na MESMA tabela dos outros (`whatsapp_config`, que é a tabela de
 * CANAIS desde a 056) com `channel_type='email'`. A credencial é uma SENHA DE
 * APP do provedor — não OAuth — e fica cifrada em `access_token`, o mesmo campo
 * e o mesmo AES-256-GCM que protege os tokens de WhatsApp e Instagram.
 *
 * Por que senha de app e não OAuth: o provedor escolhido foi o Zoho, onde OAuth
 * exigiria criar e manter um app aprovado. Senha de app serve IMAP e SMTP de uma
 * vez e é revogável no painel.
 */

import { decrypt } from '@/lib/whatsapp/encryption'
import type { ChannelConfig } from '@/lib/whatsapp/channel'

/** Teto diário de envios quando o canal não define um. Conservador de propósito:
 *  caixa nova não aguenta mais que isso sem queimar reputação. */
export const DEFAULT_DAILY_SEND_LIMIT = 50

/** Padrões por provedor, pra não obrigar o operador a decorar host/porta. */
export const EMAIL_PROVIDER_DEFAULTS: Record<
  string,
  { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }
> = {
  zoho: {
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465, // SSL implícito
  },
  google: {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
  },
}

export interface EmailChannel {
  id: string
  accountId: string
  address: string
  provider: string
  smtpHost: string
  smtpPort: number
  imapHost: string
  imapPort: number
  /** Senha de app já DECIFRADA. Nunca logar. */
  password: string
  dailySendLimit: number
  imapLastUid: number | null
  label: string | null
}

export function isEmailChannel(
  channel: ChannelConfig | null | undefined,
): boolean {
  return channel?.channel_type === 'email'
}

/**
 * Converte a linha crua de `whatsapp_config` num canal de e-mail utilizável,
 * aplicando os padrões do provedor e decifrando a senha.
 *
 * Lança se a linha não for de e-mail ou estiver incompleta — o chamador trata.
 */
export function toEmailChannel(channel: ChannelConfig): EmailChannel {
  if (!isEmailChannel(channel)) {
    throw new Error(`canal ${channel?.id} não é do tipo email`)
  }
  if (!channel.email_address) {
    throw new Error('canal de e-mail sem email_address')
  }
  if (!channel.access_token) {
    throw new Error('canal de e-mail sem credencial')
  }

  const provider = (channel.email_provider ?? 'zoho').toLowerCase()
  const defaults = EMAIL_PROVIDER_DEFAULTS[provider] ?? EMAIL_PROVIDER_DEFAULTS.zoho

  return {
    id: channel.id,
    accountId: channel.account_id,
    address: channel.email_address,
    provider,
    smtpHost: channel.smtp_host ?? defaults.smtpHost,
    smtpPort: channel.smtp_port ?? defaults.smtpPort,
    imapHost: channel.imap_host ?? defaults.imapHost,
    imapPort: channel.imap_port ?? defaults.imapPort,
    password: decrypt(channel.access_token),
    dailySendLimit: channel.daily_send_limit ?? DEFAULT_DAILY_SEND_LIMIT,
    imapLastUid: channel.imap_last_uid ?? null,
    label: channel.label ?? null,
  }
}
