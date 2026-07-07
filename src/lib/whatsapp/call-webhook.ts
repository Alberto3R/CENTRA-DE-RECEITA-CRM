/**
 * Handler do campo de webhook "calls" (WhatsApp Business Calling API).
 *
 * Recebe a `value` do change quando `field === 'calls'` e mantém a tabela
 * `whatsapp_calls` em dia. O softphone no navegador escuta essa tabela por
 * Realtime, então gravar aqui = sinalizar o SDR:
 *   - webhook de CONNECT  → grava answer_sdp + status 'connecting'
 *   - webhook de STATUS   → ringing / in_progress (accepted) / rejected
 *   - webhook de TERMINATE → completed|failed + duração; loga atividade 'call'
 *
 * Casamento de linha: chamadas business-initiated já têm uma linha criada
 * no /api/whatsapp/call com o wa_call_id — aqui damos UPDATE por wa_call_id.
 * Chamadas USER_INITIATED (entrantes) ainda não têm linha; criamos uma para
 * log (o atendimento no navegador é Fase 2).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { findExistingContact } from "@/lib/contacts/dedupe";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";

interface CallObj {
  id: string;
  to?: string;
  from?: string;
  event?: string; // 'connect' | 'terminate'
  direction?: string; // BUSINESS_INITIATED | USER_INITIATED
  timestamp?: string;
  session?: { sdp_type?: string; sdp?: string };
  status?: string; // no terminate: 'COMPLETED' | 'FAILED'
  start_time?: string;
  end_time?: string;
  duration?: number;
  biz_opaque_callback_data?: string;
}

interface CallStatus {
  id: string;
  type?: string;
  status?: string; // RINGING | ACCEPTED | REJECTED
  timestamp?: string;
  recipient_id?: string;
}

export interface CallsWebhookValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  calls?: CallObj[];
  statuses?: CallStatus[];
  errors?: Array<{ code?: number; message?: string }>;
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
}

function unixToIso(ts?: string | number): string | null {
  if (ts == null) return null;
  const n = typeof ts === "string" ? parseInt(ts, 10) : ts;
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

export async function handleCallsWebhook(
  value: CallsWebhookValue,
  supabase: SupabaseClient,
): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const { data: configRows } = await supabase
    .from("whatsapp_config")
    .select("account_id, user_id")
    .eq("phone_number_id", phoneNumberId);
  const config = configRows?.[0];
  if (!config) {
    console.error("[calls] no config for phone_number_id:", phoneNumberId);
    return;
  }
  const accountId = config.account_id as string;

  // 1) eventos de chamada (connect / terminate)
  for (const call of value.calls ?? []) {
    if (call.event === "connect") {
      const answerSdp =
        call.session?.sdp_type === "answer" ? (call.session?.sdp ?? null) : null;

      // business-initiated: já existe linha; atualiza por wa_call_id.
      const { data: existing } = await supabase
        .from("whatsapp_calls")
        .select("id")
        .eq("account_id", accountId)
        .eq("wa_call_id", call.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("whatsapp_calls")
          .update({
            answer_sdp: answerSdp,
            status: "connecting",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        // entrante (USER_INITIATED): guarda o OFFER e liga ao contato pelo
        // número de origem. O INSERT dispara o Realtime → modal de chamada
        // recebida no navegador do SDR, que gera o answer e aceita.
        const fromPhone = call.from ? normalizePhone(call.from) : null;
        let contactId: string | null = null;
        if (fromPhone) {
          try {
            const existing = await findExistingContact(
              supabase,
              accountId,
              fromPhone,
            );
            contactId = existing?.id ?? null;
          } catch {
            contactId = null;
          }
        }
        await supabase.from("whatsapp_calls").insert({
          account_id: accountId,
          user_id: config.user_id,
          contact_id: contactId,
          wa_call_id: call.id,
          direction: call.direction ?? "USER_INITIATED",
          status: "ringing",
          to_phone: call.from ?? null,
          offer_sdp:
            call.session?.sdp_type === "offer" ? (call.session?.sdp ?? null) : null,
        });
      }
    } else if (call.event === "terminate") {
      const finalStatus =
        (call.status ?? "").toUpperCase() === "COMPLETED"
          ? "completed"
          : "failed";
      const err = value.errors?.[0];
      const { data: row } = await supabase
        .from("whatsapp_calls")
        .update({
          status: finalStatus,
          start_time: unixToIso(call.start_time),
          end_time: unixToIso(call.end_time),
          duration_seconds: call.duration ?? null,
          error_code: err?.code ?? null,
          error_message: err?.message ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", accountId)
        .eq("wa_call_id", call.id)
        .select("id, contact_id, deal_id, user_id")
        .maybeSingle();

      // Loga atividade 'call' no Painel Outbound quando a chamada foi
      // efetivamente atendida (tem duração). Best-effort.
      if (row && finalStatus === "completed" && (call.duration ?? 0) > 0) {
        try {
          await supabase.from("sdr_activities").insert({
            account_id: accountId,
            user_id: row.user_id ?? config.user_id,
            contact_id: row.contact_id ?? null,
            deal_id: row.deal_id ?? null,
            tipo: "call",
          });
        } catch (e) {
          console.warn("[calls] sdr_activities log failed:", e);
        }
      }
    }
  }

  // 2) status da chamada (ringing / accepted / rejected)
  for (const st of value.statuses ?? []) {
    if (st.type && st.type !== "call") continue;
    const s = (st.status ?? "").toUpperCase();
    const mapped =
      s === "RINGING"
        ? "ringing"
        : s === "ACCEPTED"
          ? "in_progress"
          : s === "REJECTED"
            ? "rejected"
            : null;
    if (!mapped) continue;
    const patch: Record<string, unknown> = {
      status: mapped,
      updated_at: new Date().toISOString(),
    };
    if (mapped === "in_progress") patch.start_time = unixToIso(st.timestamp);
    await supabase
      .from("whatsapp_calls")
      .update(patch)
      .eq("account_id", accountId)
      .eq("wa_call_id", st.id);
  }
}
