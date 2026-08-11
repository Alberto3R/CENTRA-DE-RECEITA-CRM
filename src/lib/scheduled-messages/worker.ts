// Worker das mensagens agendadas.
//
// O vendedor combina uma data com o lead ("te chamo dia 20") e agenda o
// toque na própria conversa. Este worker é drenado a cada minuto pelo
// pg_cron (migration 087) via /api/whatsapp/scheduled/process.
//
// SÓ TEMPLATE, por desenho: um agendamento para dias à frente cai fora
// da janela de 24h do WhatsApp, e fora dela a Meta recusa texto livre
// com #131047. Ver o comentário da migration 086.

import { engineSendTemplate } from "@/lib/automations/meta-send";
import { supabaseAdmin } from "@/lib/flows/admin-client";

/** Teto por invocação. A rota roda com maxDuration=60. */
const BATCH = 25;

export interface ScheduledRow {
  id: string;
  account_id: string;
  conversation_id: string;
  contact_id: string;
  template_name: string;
  template_language: string;
  template_params: string[] | null;
  preview: string;
  created_by: string | null;
}

export interface ProcessResult {
  claimed: number;
  sent: number;
  failed: number;
}

export async function processDueScheduledMessages(): Promise<ProcessResult> {
  const admin = supabaseAdmin();

  const { data: claimed, error: claimErr } = await admin.rpc(
    "claim_scheduled_messages",
    { p_limit: BATCH },
  );
  if (claimErr) {
    console.error("[scheduled] claim falhou:", claimErr.message);
    return { claimed: 0, sent: 0, failed: 0 };
  }

  const rows = (claimed ?? []) as ScheduledRow[];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // A Meta pode ter pausado ou reprovado o template entre o
      // agendamento e agora. Mandar assim mesmo devolveria um erro
      // cru; melhor falhar com uma explicação que o vendedor entende.
      const { data: tpl } = await admin
        .from("message_templates")
        .select("status")
        .eq("account_id", row.account_id)
        .eq("name", row.template_name)
        .eq("language", row.template_language)
        .maybeSingle();

      const status = (tpl as { status?: string } | null)?.status;
      if (status !== "APPROVED") {
        await markFailed(
          row.id,
          status
            ? `O modelo "${row.template_name}" está ${status} na Meta — só modelos APPROVED podem ser enviados.`
            : `O modelo "${row.template_name}" não existe mais nesta conta.`,
        );
        failed += 1;
        continue;
      }

      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: row.account_id,
        userId: row.created_by ?? "",
        conversationId: row.conversation_id,
        contactId: row.contact_id,
        templateName: row.template_name,
        language: row.template_language,
        params: row.template_params ?? [],
        // Foi uma pessoa que escreveu e escolheu a hora — o balão precisa
        // dizer isso, senão o time acha que a IA respondeu sozinha.
        senderType: "agent",
        senderId: row.created_by,
        contentText: row.preview,
      });

      await admin
        .from("scheduled_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          wa_message_id: whatsapp_message_id,
          claimed_at: null,
          error: null,
        })
        .eq("id", row.id);

      await handOffToHuman(row);
      sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled] envio ${row.id} falhou:`, msg);
      await markFailed(row.id, msg);
      failed += 1;
    }
  }

  return { claimed: rows.length, sent, failed };
}

async function markFailed(id: string, error: string) {
  await supabaseAdmin()
    .from("scheduled_messages")
    .update({ status: "failed", error, claimed_at: null })
    .eq("id", id);
}

/**
 * Mesmo efeito colateral do envio manual (/api/whatsapp/send): pausa a IA
 * nativa e os fluxos ativos do contato. O vendedor agendou a retomada
 * porque quer conduzir dali em diante — deixar a IA responder por cima
 * seria atropelar exatamente a conversa que ele preparou.
 *
 * Best-effort: a mensagem já saiu para a Meta, então uma falha de
 * bookkeeping não deve derrubar o envio.
 */
async function handOffToHuman(row: ScheduledRow) {
  const admin = supabaseAdmin();

  try {
    const { error } = await admin
      .from("conversations")
      .update({ ai_handoff: true, updated_at: new Date().toISOString() })
      .eq("id", row.conversation_id);
    if (error) console.warn("[scheduled] ai_handoff falhou:", error.message);
  } catch (err) {
    console.warn(
      "[scheduled] ai_handoff lançou:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const { error } = await admin
      .from("flow_runs")
      .update({
        status: "paused_by_agent",
        ended_at: new Date().toISOString(),
        end_reason: "agent_replied",
      })
      .eq("account_id", row.account_id)
      .eq("contact_id", row.contact_id)
      .eq("status", "active");
    if (error) console.warn("[scheduled] pausa de flow falhou:", error.message);
  } catch (err) {
    console.warn(
      "[scheduled] pausa de flow lançou:",
      err instanceof Error ? err.message : err,
    );
  }
}
