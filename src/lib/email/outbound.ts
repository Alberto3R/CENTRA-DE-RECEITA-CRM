/**
 * Envio de e-mail por SMTP (canal `channel_type='email'`, migration 091).
 *
 * Regras que este módulo garante:
 *   1. UM destinatário por mensagem. Nunca `to: [a, b, c]` e nunca BCC em
 *      lote — 50 e-mails individuais, não 1 e-mail para 50. Além de ser o que
 *      converte, é o que não parece disparo de lista.
 *   2. Threading correto. Guardamos o Message-ID de tudo que sai; ao responder,
 *      mandamos In-Reply-To + References, que é como o cliente de e-mail (e o
 *      nosso polling IMAP) casa a resposta na conversa certa.
 *   3. Nada de HTML por padrão. E-mail de prospecção em texto puro entrega
 *      melhor e não carrega rastreador — que é justamente o que marca
 *      "isto é uma campanha".
 *
 * ⚠️ Exige runtime Node (nodemailer usa sockets TCP). No Next 16.2.6 `nodejs`
 * já é o DEFAULT — não precisa declarar nada. O cuidado é o inverso: nunca
 * marcar `export const runtime = 'edge'` numa rota que chegue aqui.
 */

import nodemailer, { type Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import type { EmailChannel } from './config'

/** Transporters são caros (handshake TLS) e reusáveis. Cache por canal.
 *  Em serverless o processo é efêmero, então o cache vale dentro de uma
 *  invocação que manda vários — exatamente o caso do worker de disparo. */
type SmtpTransporter = Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options>

const transporters = new Map<string, SmtpTransporter>()

export function getTransporter(channel: EmailChannel): SmtpTransporter {
  const cached = transporters.get(channel.id)
  if (cached) return cached

  const t = nodemailer.createTransport({
    host: channel.smtpHost,
    port: channel.smtpPort,
    secure: channel.smtpPort === 465, // 465 = SSL implícito; 587 = STARTTLS
    auth: { user: channel.address, pass: channel.password },
    // Sem pool de propósito: uma conexão por envio dá cadência humana em vez
    // de rajada. (`pool` nem existe em SMTPTransport.Options — pool é outro
    // transporte; o default já é sem pool.)
  })
  transporters.set(channel.id, t)
  return t
}

/** Limpa o cache de um canal — chamar ao trocar a senha de app. */
export function invalidarTransporter(channelId: string): void {
  transporters.get(channelId)?.close?.()
  transporters.delete(channelId)
}

export interface EnviarEmailArgs {
  channel: EmailChannel
  /** UM destinatário. O tipo é string, não array, de propósito. */
  para: string
  assunto: string
  texto: string
  /** Nome de exibição do remetente (ex.: "Ana Clara · Sales 3R"). */
  remetenteNome?: string
  /** Message-ID da mensagem sendo respondida — liga a thread. */
  emRespostaA?: string | null
  /** Cadeia completa de References da thread. */
  referencias?: string[] | null
}

export interface EnvioResultado {
  /** Message-ID gerado — persistir em `messages.message_id` para o threading. */
  messageId: string
  aceitos: string[]
  rejeitados: string[]
}

/**
 * Manda UM e-mail. Não grava no banco e não checa quota — quem chama faz as
 * duas coisas (mesma divisão de responsabilidade do `sendTextViaChannel`).
 *
 * Lança em falha de SMTP; o chamador loga e decide se re-tenta.
 */
export async function enviarEmailSMTP(
  args: EnviarEmailArgs,
): Promise<EnvioResultado> {
  const { channel, para, assunto, texto, remetenteNome } = args

  if (!para || !para.includes('@')) {
    throw new Error(`destinatário inválido: ${para}`)
  }
  if (!assunto?.trim()) {
    throw new Error('e-mail sem assunto — vai direto para spam')
  }

  const from = remetenteNome
    ? `${remetenteNome} <${channel.address}>`
    : channel.address

  const info = await getTransporter(channel).sendMail({
    from,
    to: para,
    subject: assunto,
    text: texto,
    // Resposta volta para a própria caixa do canal — é ela que o polling lê.
    replyTo: channel.address,
    ...(args.emRespostaA ? { inReplyTo: args.emRespostaA } : {}),
    ...(args.referencias?.length ? { references: args.referencias } : {}),
  })

  return {
    messageId: info.messageId,
    aceitos: (info.accepted ?? []).map(String),
    rejeitados: (info.rejected ?? []).map(String),
  }
}

/**
 * Confere que a caixa aceita a credencial e está alcançável.
 * Usar no botão "Testar conexão" da tela de configuração — falha de senha de
 * app tem que aparecer na hora de configurar, não no meio de um disparo.
 */
export async function verificarSMTP(
  channel: EmailChannel,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    await getTransporter(channel).verify()
    return { ok: true }
  } catch (err) {
    invalidarTransporter(channel.id)
    return { ok: false, erro: err instanceof Error ? err.message : String(err) }
  }
}
