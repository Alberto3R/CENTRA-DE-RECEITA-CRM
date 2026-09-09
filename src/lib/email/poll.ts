/**
 * Recebimento — busca as respostas na caixa e as põe no inbox do CRM.
 *
 * Roda por cron (2 min) porque IMAP IDLE não sobrevive em serverless: a função
 * congela ao responder e a conexão persistente morre com ela. Mesma razão pela
 * qual o webhook do WhatsApp precisou de `after()`.
 *
 * O que decide se isto funciona não é o IMAP, é o casamento: a resposta tem que
 * cair NA conversa certa, do contato certo. Por isso a ordem é
 * thread → contato → conversa nova, nunca o contrário.
 */

import { simpleParser, type ParsedMail } from "mailparser";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { toEmailChannel, type EmailChannel } from "./config";
import { criarClienteIMAP, traduzirErroIMAP } from "./inbound";
import {
  corpoParaInbox,
  extrairReferencias,
  nomeDoRemetente,
  normalizarEmail,
} from "./parse";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Teto de mensagens por passada. Caixa parada por dias não pode virar uma
 *  rodada de 40 minutos que estoura o tempo da função. */
const MAX_POR_PASSADA = 25;

export interface ResultadoPoll {
  canais: number;
  novas: number;
  erros: { canal: string; erro: string }[];
}

/**
 * Quem é o remetente dentro da conta.
 *
 * A base tem 111 e-mails repetidos DENTRO da mesma conta (um endereço aparece
 * 10 vezes), então "achar o contato pelo e-mail" devolve vários. A regra:
 * prefere quem já tem conversa aberta neste canal — é a pessoa com quem se
 * está falando —, senão o cadastro mais recente. Sem isso, a resposta cai num
 * cadastro velho e some da vista de quem está atendendo.
 */
async function resolverContato(
  db: Admin,
  accountId: string,
  channelId: string,
  email: string,
  nome: string,
): Promise<string | null> {
  const { data: candidatos } = await db
    .from("contacts")
    .select("id, created_at")
    .eq("account_id", accountId)
    .ilike("email", email)
    .order("created_at", { ascending: false });

  const ids = (candidatos ?? []).map((c: { id: string }) => c.id);

  if (ids.length > 1) {
    const { data: comConversa } = await db
      .from("conversations")
      .select("contact_id")
      .eq("account_id", accountId)
      .eq("channel_id", channelId)
      .in("contact_id", ids)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const preferido = (comConversa ?? [])[0]?.contact_id;
    if (preferido) return preferido;
  }
  if (ids.length >= 1) return ids[0];

  // Remetente novo: vira contato. Sem telefone — e o inbox aguenta isso desde
  // o canal de Instagram (ver channel-display.tsx).
  const { data: criado, error } = await db
    .from("contacts")
    .insert({
      account_id: accountId,
      user_id: null,
      name: nome || email.split("@")[0],
      email,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[email/poll] não consegui criar contato:", error.message);
    return null;
  }
  return (criado as { id: string }).id;
}

/**
 * A conversa em que esta mensagem entra.
 *
 * Primeiro pela THREAD (o Message-ID que a resposta cita está gravado em
 * `messages.message_id` do que nós enviamos) — é o casamento exato. Só depois
 * cai para "a conversa deste contato neste canal", e por último cria uma.
 */
async function resolverConversa(
  db: Admin,
  channel: EmailChannel,
  contactId: string,
  referencias: string[],
): Promise<string | null> {
  if (referencias.length > 0) {
    const { data: ancora } = await db
      .from("messages")
      .select("conversation_id")
      .in("message_id", referencias)
      .limit(1)
      .maybeSingle();
    const conversationId = (ancora as { conversation_id?: string } | null)?.conversation_id;
    if (conversationId) return conversationId;
  }

  const { data: existente } = await db
    .from("conversations")
    .select("id")
    .eq("account_id", channel.accountId)
    .eq("channel_id", channel.id)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (existente) return (existente as { id: string }).id;

  const { data: dono } = await db
    .from("accounts")
    .select("owner_user_id")
    .eq("id", channel.accountId)
    .maybeSingle();

  const { data: nova, error } = await db
    .from("conversations")
    .insert({
      account_id: channel.accountId,
      user_id: (dono as { owner_user_id?: string } | null)?.owner_user_id ?? null,
      contact_id: contactId,
      channel_id: channel.id,
      status: "open",
    })
    .select("id")
    .single();
  if (error) {
    console.error("[email/poll] não consegui abrir conversa:", error.message);
    return null;
  }
  return (nova as { id: string }).id;
}

/** Grava a mensagem recebida. Devolve false se já estava lá (idempotência). */
async function gravarMensagem(
  db: Admin,
  conversationId: string,
  email: ParsedMail,
  messageId: string,
): Promise<boolean> {
  const { data: jaExiste } = await db
    .from("messages")
    .select("id")
    .eq("message_id", messageId)
    .maybeSingle();
  if (jaExiste) return false;

  const corpo = corpoParaInbox(email.text ?? "");
  const assunto = email.subject ?? null;
  // Balão vazio não ajuda ninguém a atender: quando o corpo some (e-mail só com
  // anexo, ou só HTML que o parser não converteu), o assunto vira o texto.
  const texto = corpo || assunto || "(mensagem sem texto)";

  const { error } = await db.from("messages").insert({
    conversation_id: conversationId,
    // Regra do CRM: quem escreve de fora é sempre 'customer'.
    sender_type: "customer",
    content_type: "text",
    content_text: texto,
    subject: assunto,
    message_id: messageId,
    status: "delivered",
  });
  if (error) {
    console.error("[email/poll] não consegui gravar a mensagem:", error.message);
    return false;
  }

  const { data: conversaAtual } = await db
    .from("conversations")
    .select("unread_count")
    .eq("id", conversationId)
    .maybeSingle();
  const naoLidas = ((conversaAtual as { unread_count?: number } | null)?.unread_count ?? 0) + 1;

  await db
    .from("conversations")
    .update({
      last_message_text: texto.slice(0, 500),
      last_message_at: (email.date ?? new Date()).toISOString(),
      unread_count: naoLidas,
      status: "open",
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
  return true;
}

/** Remetentes que não são gente: bounce e piloto automático. */
function ehRemetenteDeSistema(email: string): boolean {
  const local = email.split("@")[0];
  return [
    "mailer-daemon",
    "postmaster",
    "no-reply",
    "noreply",
    "bounce",
    "bounces",
  ].includes(local);
}

async function processarCanal(
  db: Admin,
  channel: EmailChannel,
): Promise<{ novas: number }> {
  const cliente = criarClienteIMAP(channel);
  let novas = 0;
  let maiorUid = channel.imapLastUid ?? 0;

  await cliente.connect();
  try {
    const lock = await cliente.getMailboxLock("INBOX");
    try {
      // Primeira passada de uma caixa nova pega só o que está por ler; das
      // seguintes em diante, tudo com UID acima do último visto. É o UID que
      // garante não reprocessar — "não lido" muda quando alguém abre no
      // webmail, e aí a mesma resposta entraria duas vezes.
      const criterio =
        channel.imapLastUid && channel.imapLastUid > 0
          ? { uid: `${channel.imapLastUid + 1}:*` }
          : { seen: false };

      const uids = (await cliente.search(criterio, { uid: true })) || [];
      const aProcessar = uids.slice(-MAX_POR_PASSADA);

      for (const uid of aProcessar) {
        const msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;

        const email = await simpleParser(msg.source);
        const de = normalizarEmail(email.from?.text);
        if (!de) continue;
        if (de === channel.address.toLowerCase()) continue; // eco da própria caixa
        if (ehRemetenteDeSistema(de)) {
          if (uid > maiorUid) maiorUid = uid;
          continue;
        }

        const messageId = email.messageId ?? `<sem-id-${channel.id}-${uid}>`;
        const contactId = await resolverContato(
          db,
          channel.accountId,
          channel.id,
          de,
          nomeDoRemetente(email.from?.text),
        );
        if (!contactId) continue;

        const referencias = extrairReferencias(email.inReplyTo, email.references);
        const conversationId = await resolverConversa(db, channel, contactId, referencias);
        if (!conversationId) continue;

        if (await gravarMensagem(db, conversationId, email, messageId)) novas += 1;
        if (uid > maiorUid) maiorUid = uid;
      }
    } finally {
      lock.release();
    }
  } finally {
    await cliente.logout().catch(() => {});
  }

  await db
    .from("whatsapp_config")
    .update({
      imap_last_uid: maiorUid > 0 ? maiorUid : null,
      last_poll_at: new Date().toISOString(),
    })
    .eq("id", channel.id);

  return { novas };
}

/**
 * Varre as caixas de todos os canais de e-mail conectados.
 *
 * Um canal que falha não derruba os outros: cada erro é registrado e a varredura
 * continua. Caixa com IMAP desligado no painel do provedor é o caso mais comum,
 * e o texto traduzido diz exatamente isso em vez de "Command failed".
 */
export async function processarCaixasDeEntrada(): Promise<ResultadoPoll> {
  const db = supabaseAdmin();
  const resultado: ResultadoPoll = { canais: 0, novas: 0, erros: [] };

  const { data: linhas, error } = await db
    .from("whatsapp_config")
    .select("*")
    .eq("channel_type", "email")
    .eq("status", "connected");
  if (error) {
    resultado.erros.push({ canal: "—", erro: `listar canais: ${error.message}` });
    return resultado;
  }

  for (const linha of linhas ?? []) {
    let channel: EmailChannel;
    try {
      channel = toEmailChannel(linha);
    } catch (err) {
      resultado.erros.push({
        canal: (linha as { id: string }).id,
        erro: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    resultado.canais += 1;
    try {
      const { novas } = await processarCanal(db, channel);
      resultado.novas += novas;
    } catch (err) {
      const bruto = err instanceof Error ? err.message : String(err);
      resultado.erros.push({ canal: channel.address, erro: traduzirErroIMAP(bruto) });
    }
  }

  return resultado;
}
