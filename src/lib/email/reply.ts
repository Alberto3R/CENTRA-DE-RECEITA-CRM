/**
 * Responder um e-mail pelo inbox do CRM.
 *
 * Espelha `sendInstagramReply`: a rota de envio do inbox precisa de um caminho
 * por canal, e sem este a Ana Clara vê a resposta do lead chegar e não tem como
 * responder — o canal serviria só para disparar, que é metade do trabalho.
 *
 * Três coisas que só existem no e-mail e não podem ser esquecidas:
 *  1. **assunto** — resposta sem "Re: <assunto original>" abre uma thread nova
 *     no cliente de e-mail do lead, e a conversa se parte em duas;
 *  2. **In-Reply-To / References** — é o que faz a resposta dele voltar para
 *     ESTA conversa quando o poll a ler;
 *  3. **quota** — o teto diário existe para proteger a reputação da caixa.
 */

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { resolveChannelConfig } from "@/lib/whatsapp/channel";
import { isEmailChannel, toEmailChannel } from "./config";
import { enviarEmailSMTP } from "./outbound";
import { assuntoLimpo, extrairReferencias } from "./parse";
import { consultarQuota } from "./quota";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface RespostaEmail {
  ok: boolean;
  status?: number;
  error?: string;
  messageId?: string;
  subject?: string;
}

/** O contato desta conversa tem e-mail e o canal é de e-mail? */
export async function conversaEhDeEmail(
  db: Db,
  accountId: string,
  channelId: string | null | undefined,
): Promise<boolean> {
  const canal = await resolveChannelConfig(db, accountId, channelId ?? undefined);
  return isEmailChannel(canal);
}

export async function responderPorEmail(args: {
  supabase: Db;
  accountId: string;
  userId: string;
  conversation: { id: string; channel_id?: string | null };
  contact: { id: string; email?: string | null; name?: string | null };
  text: string;
}): Promise<RespostaEmail> {
  const { supabase, accountId, conversation, contact, text } = args;

  if (!contact.email) {
    return { ok: false, status: 400, error: "Contato sem e-mail." };
  }

  const linha = await resolveChannelConfig(
    supabase,
    accountId,
    conversation.channel_id ?? undefined,
  );
  if (!isEmailChannel(linha)) {
    return { ok: false, status: 400, error: "Esta conversa não é de um canal de e-mail." };
  }

  let channel;
  try {
    channel = toEmailChannel(linha!);
  } catch (err) {
    return {
      ok: false,
      status: 400,
      error: err instanceof Error ? err.message : "Canal de e-mail incompleto.",
    };
  }

  const admin = supabaseAdmin();

  // Assunto e thread saem da última mensagem QUE O LEAD MANDOU: é o Message-ID
  // dele que o cliente de e-mail espera ver em In-Reply-To.
  const { data: ultimaDoLead } = await admin
    .from("messages")
    .select("message_id, subject")
    .eq("conversation_id", conversation.id)
    .eq("sender_type", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Sem resposta do lead ainda (primeiro contato saindo do inbox): pega o
  // assunto do que nós mandamos, para não abrir thread nova.
  const { data: ultimaNossa } = await admin
    .from("messages")
    .select("subject")
    .eq("conversation_id", conversation.id)
    .neq("sender_type", "customer")
    .not("subject", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const base =
    assuntoLimpo((ultimaDoLead as { subject?: string } | null)?.subject) ||
    assuntoLimpo((ultimaNossa as { subject?: string } | null)?.subject);
  const assunto = base ? `Re: ${base}` : `Contato · ${channel.label ?? "Sales 3R"}`;

  const emRespostaA = (ultimaDoLead as { message_id?: string } | null)?.message_id ?? null;

  // Teto diário: informa, mas NÃO bloqueia uma resposta.
  //
  // O teto existe para segurar prospecção — envio em massa para quem não pediu.
  // Responder alguém que acabou de escrever é o oposto disso: é a conversa que
  // o provedor QUER ver, e travar a resposta faria o CRM deixar um lead falando
  // sozinho porque a fila de prospecção do dia acabou.
  let aviso: string | undefined;
  try {
    const quota = await consultarQuota(admin, channel.id, channel.dailySendLimit);
    if (quota.estourou) {
      aviso = `Teto diário da caixa atingido (${quota.enviadosHoje}/${quota.limite}). A resposta foi enviada assim mesmo.`;
      console.warn(`[email/reply] ${aviso}`);
    }
  } catch (err) {
    console.warn(
      "[email/reply] não consegui consultar a quota:",
      err instanceof Error ? err.message : err,
    );
  }

  let resultado;
  try {
    resultado = await enviarEmailSMTP({
      channel,
      para: contact.email,
      assunto,
      texto: text,
      remetenteNome: channel.label ?? undefined,
      emRespostaA,
      referencias: extrairReferencias(emRespostaA, null),
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    console.error("[email/reply] SMTP recusou:", detalhe);
    return { ok: false, status: 502, error: `Falha no envio: ${detalhe}` };
  }

  const { data: gravada, error: erroGravar } = await admin
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      // Foi uma pessoa que escreveu e mandou — o balão precisa dizer isso, ou o
      // time acha que a IA respondeu sozinha.
      sender_type: "agent",
      content_type: "text",
      content_text: text,
      subject: assunto,
      message_id: resultado.messageId,
      status: "sent",
    })
    .select("id")
    .single();
  if (erroGravar) {
    // O e-mail SAIU. Falhar aqui não desfaz nada — avisamos para ninguém
    // reenviar achando que não foi.
    console.error("[email/reply] enviado, mas não gravou:", erroGravar.message);
    return {
      ok: false,
      status: 500,
      error: "E-mail enviado, mas não foi possível registrar no histórico.",
      messageId: resultado.messageId,
    };
  }

  await admin
    .from("conversations")
    .update({
      last_message_text: text.slice(0, 500),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Humano respondeu: a IA para de falar por cima (mesma regra do WhatsApp).
      ai_handoff: true,
    })
    .eq("id", conversation.id);

  return {
    ok: true,
    messageId: (gravada as { id: string }).id,
    subject: assunto,
    error: aviso,
  };
}
