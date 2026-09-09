/**
 * Recebimento por IMAP (base da Fase 3).
 *
 * Por que polling e não IDLE: IMAP IDLE mantém uma conexão aberta esperando o
 * servidor avisar. Em serverless a função congela assim que responde — a
 * conexão morre e os avisos se perdem. O mesmo motivo pelo qual o webhook do
 * WhatsApp precisou de `after()`. Aqui a saída é um cron chamando um endpoint,
 * que é o desenho que o projeto já usa em 13 jobs do pg_cron.
 */

import { ImapFlow } from 'imapflow'
import type { EmailChannel } from './config'

export function criarClienteIMAP(channel: EmailChannel): ImapFlow {
  return new ImapFlow({
    host: channel.imapHost,
    port: channel.imapPort,
    secure: true,
    auth: { user: channel.address, pass: channel.password },
    logger: false,
  })
}

/**
 * Traduz o erro cru do IMAP para algo acionável.
 *
 * O caso que motivou isto: o Zoho responde
 *   `NO [ALERT] You are yet to enable IMAP for your account`
 * mas o imapflow entrega só "Command failed". Sem tradução, o operador vê uma
 * falha genérica e conclui que a senha está errada — quando a MESMA senha
 * autentica no SMTP sem problema. O que falta é uma opção no painel.
 */
export function traduzirErroIMAP(bruto: string): string {
  const t = bruto.toLowerCase()
  if (t.includes('yet to enable imap') || t.includes('imap for your account')) {
    return (
      'O IMAP está desabilitado nesta conta. Habilite em Zoho Mail → Admin Console → ' +
      'Mail Settings → IMAP Access. (Não é senha errada: a mesma credencial funciona no envio.)'
    )
  }
  if (t.includes('authenticationfailed') || t.includes('invalid credentials') || t.includes('login failed')) {
    return 'Credencial recusada. Gere uma nova senha de app no provedor e salve de novo.'
  }
  if (t.includes('command failed')) {
    return (
      'O servidor recusou a conexão sem detalhar. A causa mais comum é o acesso IMAP ' +
      'estar desligado no painel do provedor.'
    )
  }
  if (t.includes('enotfound') || t.includes('econnrefused') || t.includes('timeout')) {
    return `Não foi possível alcançar o servidor IMAP. Confira host e porta. (${bruto})`
  }
  return bruto
}

export interface ResultadoIMAP {
  ok: boolean
  erro?: string
  /** Quantas mensagens existem na INBOX (só quando ok). */
  mensagens?: number
}

/** Conecta, abre a INBOX e desconecta. Usado no botão "Testar conexão". */
export async function verificarIMAP(channel: EmailChannel): Promise<ResultadoIMAP> {
  const cliente = criarClienteIMAP(channel)
  try {
    await cliente.connect()
  } catch (err) {
    const bruto = err instanceof Error ? err.message : String(err)
    return { ok: false, erro: traduzirErroIMAP(bruto) }
  }
  try {
    const lock = await cliente.getMailboxLock('INBOX')
    try {
      const total =
        typeof cliente.mailbox === 'object' && cliente.mailbox ? cliente.mailbox.exists : 0
      return { ok: true, mensagens: total }
    } finally {
      lock.release()
    }
  } catch (err) {
    const bruto = err instanceof Error ? err.message : String(err)
    return { ok: false, erro: traduzirErroIMAP(bruto) }
  } finally {
    await cliente.logout().catch(() => {})
  }
}
