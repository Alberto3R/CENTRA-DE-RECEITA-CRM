// Grava no inbox o template que o gatilho de etapa mandou direto pela Meta.
//
// O deal-trigger envia o HSM com sendTemplateMessage (não pelo
// engineSendTemplate, que exige uma conversa já aberta e não repassa a
// linha do template — botões/cabeçalho). Até 24/11/2026 ele parava aí: a
// Meta entregava, mas a conversa no CRM ficava sem a mensagem. Quem
// respondia chegava "do nada" pro time, sem o contexto do que tinha
// recebido, e o time mandava uma segunda abertura à mão.
//
// Aqui: acha (ou cria) a conversa do contato no canal, insere a mensagem
// com o id da Meta (o webhook de status atualiza entregue/lida por ele) e
// atualiza a prévia da conversa. Falha aqui NUNCA desfaz o envio — a
// mensagem já saiu; quem chama só registra o erro.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Corpo do template com os parâmetros, pro balão do inbox não ficar vazio. */
export function renderizarCorpo(body: string | null | undefined, params: string[]): string | null {
  if (!body) return null;
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
}

export interface MensagemDeTemplate {
  conversation_id: string;
  sender_type: "bot";
  content_type: "template";
  content_text: string | null;
  template_name: string;
  message_id: string;
  status: "sent";
}

export function montarMensagemDeTemplate(args: {
  conversationId: string;
  templateName: string;
  bodyText: string | null | undefined;
  params: string[];
  waMessageId: string;
}): MensagemDeTemplate {
  return {
    conversation_id: args.conversationId,
    sender_type: "bot",
    content_type: "template",
    content_text: renderizarCorpo(args.bodyText, args.params),
    template_name: args.templateName,
    message_id: args.waMessageId,
    status: "sent",
  };
}

async function acharOuCriarConversa(
  db: Admin,
  accountId: string,
  contactId: string,
  channelId: string | null,
): Promise<string | null> {
  const achar = async (porCanal: boolean) => {
    let q = db.from("conversations").select("id").eq("account_id", accountId).eq("contact_id", contactId);
    if (porCanal && channelId) q = q.eq("channel_id", channelId);
    const { data } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };
  // 1) conversa no mesmo canal; 2) qualquer conversa do contato (contas
  // antigas sem channel_id preenchido); 3) cria.
  const noCanal = await achar(true);
  if (noCanal) return noCanal;
  if (channelId) {
    const qualquer = await achar(false);
    if (qualquer) return qualquer;
  }
  const { data: acc } = await db.from("accounts").select("owner_user_id").eq("id", accountId).maybeSingle();
  const ownerId = (acc as { owner_user_id?: string } | null)?.owner_user_id;
  if (!ownerId) return null;
  const { data: criada } = await db
    .from("conversations")
    .insert({ account_id: accountId, user_id: ownerId, contact_id: contactId, channel_id: channelId })
    .select("id")
    .single();
  return (criada as { id: string } | null)?.id ?? (await achar(false));
}

export async function registrarTemplateNaConversa(
  db: Admin,
  args: {
    accountId: string;
    contactId: string;
    channelId: string | null;
    templateName: string;
    bodyText: string | null | undefined;
    params: string[];
    waMessageId: string;
  },
): Promise<{ ok: true; conversationId: string } | { ok: false; motivo: string }> {
  const conversationId = await acharOuCriarConversa(db, args.accountId, args.contactId, args.channelId);
  if (!conversationId) return { ok: false, motivo: "sem_conversa" };

  const linha = montarMensagemDeTemplate({ ...args, conversationId });
  const { error } = await db.from("messages").insert(linha);
  if (error) return { ok: false, motivo: `insert: ${error.message}` };

  const agora = new Date().toISOString();
  await db
    .from("conversations")
    .update({
      last_message_text: linha.content_text ?? `[template:${args.templateName}]`,
      last_message_at: agora,
      updated_at: agora,
    })
    .eq("id", conversationId);
  return { ok: true, conversationId };
}
