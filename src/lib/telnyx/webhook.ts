/**
 * Handler dos webhooks de Call Control do Telnyx (ligação PSTN).
 *
 * Mantém `telnyx_calls` em dia (o histórico e o softphone escutam por
 * Realtime). Espelha o call-webhook.ts do WhatsApp:
 *   - call.initiated       → linka/casa a linha + status 'ringing'
 *   - call.answered        → 'answered' + start_time + dispara gravação
 *   - call.hangup          → 'completed'|'failed' + duração; loga atividade 'call'
 *   - call.recording.saved → grava recording_url + recording_id (player no CRM)
 *
 * Casamento da linha (outbound): o /api/telnyx/call cria a linha ANTES de o
 * softphone discar e passa o id dela no `client_state` da chamada WebRTC. Aqui
 * decodificamos o client_state; fallback = call_control_id já gravado, ou a
 * linha mais recente 'initiating'/'ringing' pro mesmo destino.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { startRecording } from "@/lib/telnyx/calling";

interface TelnyxPayload {
  call_control_id?: string;
  call_leg_id?: string;
  call_session_id?: string;
  connection_id?: string;
  from?: string;
  to?: string;
  direction?: string; // "incoming" | "outgoing"
  state?: string;
  client_state?: string; // base64 — nosso telnyx_calls.id
  hangup_cause?: string;
  hangup_source?: string;
  start_time?: string;
  end_time?: string;
  recording_id?: string;
  recording_urls?: { mp3?: string; wav?: string };
  public_recording_urls?: { mp3?: string; wav?: string };
  recording_started_at?: string;
  recording_ended_at?: string;
}

export interface TelnyxWebhookEvent {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: TelnyxPayload;
  };
}

function decodeClientState(cs?: string): string | null {
  if (!cs) return null;
  try {
    const s = Buffer.from(cs, "base64").toString("utf8").trim();
    // esperamos um uuid do telnyx_calls
    return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
  } catch {
    return null;
  }
}

/** Acha a linha telnyx_calls correspondente ao evento. */
async function findRow(
  supabase: SupabaseClient,
  p: TelnyxPayload,
): Promise<{ id: string; account_id: string; contact_id: string | null; deal_id: string | null; user_id: string | null } | null> {
  const cols = "id, account_id, contact_id, deal_id, user_id";

  const rowId = decodeClientState(p.client_state);
  if (rowId) {
    const { data } = await supabase
      .from("telnyx_calls")
      .select(cols)
      .eq("id", rowId)
      .maybeSingle();
    if (data) return data;
  }

  if (p.call_control_id) {
    const { data } = await supabase
      .from("telnyx_calls")
      .select(cols)
      .eq("call_control_id", p.call_control_id)
      .maybeSingle();
    if (data) return data;
  }

  // fallback: linha recente 'initiating'/'ringing' pro mesmo destino
  if (p.to) {
    const to = p.to.replace(/\D/g, "");
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: byPhone } = await supabase
      .from("telnyx_calls")
      .select(cols)
      .eq("to_phone", to)
      .in("status", ["initiating", "ringing"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    return byPhone?.[0] ?? null;
  }

  return null;
}

export async function handleTelnyxWebhook(
  event: TelnyxWebhookEvent,
  supabase: SupabaseClient,
): Promise<void> {
  const type = event.data?.event_type;
  const p = event.data?.payload;
  if (!type || !p) return;

  const now = new Date().toISOString();

  switch (type) {
    case "call.initiated": {
      const row = await findRow(supabase, p);
      if (!row) return; // inbound sem linha = Fase 2 (atendimento no navegador)
      await supabase
        .from("telnyx_calls")
        .update({
          call_control_id: p.call_control_id ?? null,
          call_leg_id: p.call_leg_id ?? null,
          call_session_id: p.call_session_id ?? null,
          status: "ringing",
          updated_at: now,
        })
        .eq("id", row.id);
      break;
    }

    case "call.answered": {
      const row = await findRow(supabase, p);
      if (!row) return;
      await supabase
        .from("telnyx_calls")
        .update({
          status: "answered",
          call_control_id: p.call_control_id ?? null,
          start_time: p.start_time ?? now,
          updated_at: now,
        })
        .eq("id", row.id);
      // grava a chamada (best-effort; a URL chega em call.recording.saved)
      if (p.call_control_id) await startRecording(p.call_control_id);
      break;
    }

    case "call.hangup": {
      const row = await findRow(supabase, p);
      if (!row) return;
      const cause = (p.hangup_cause ?? "").toLowerCase();
      // "normal_clearing" / "originator_cancel" após atender = completed
      const wasAnswered = !!p.start_time && !!p.end_time;
      const duration =
        p.start_time && p.end_time
          ? Math.max(
              0,
              Math.round(
                (new Date(p.end_time).getTime() -
                  new Date(p.start_time).getTime()) /
                  1000,
              ),
            )
          : 0;
      const finalStatus =
        cause === "normal_clearing" || wasAnswered
          ? duration > 0
            ? "completed"
            : "no_answer"
          : cause === "user_busy"
            ? "busy"
            : cause === "call_rejected"
              ? "no_answer"
              : "failed";

      await supabase
        .from("telnyx_calls")
        .update({
          status: finalStatus,
          hangup_cause: p.hangup_cause ?? null,
          end_time: p.end_time ?? now,
          duration_seconds: duration,
          updated_at: now,
        })
        .eq("id", row.id);

      // Auto-log de atividade 'call' no Painel Outbound (só quando atendida).
      if (finalStatus === "completed" && duration > 0) {
        try {
          await supabase.from("sdr_activities").insert({
            account_id: row.account_id,
            user_id: row.user_id,
            contact_id: row.contact_id,
            deal_id: row.deal_id,
            tipo: "call",
          });
        } catch (e) {
          console.warn("[telnyx] sdr_activities log falhou:", e);
        }
      }
      break;
    }

    case "call.recording.saved": {
      const url =
        p.public_recording_urls?.mp3 ??
        p.recording_urls?.mp3 ??
        p.public_recording_urls?.wav ??
        p.recording_urls?.wav ??
        null;
      const patch: Record<string, unknown> = {
        recording_url: url,
        recording_id: p.recording_id ?? null,
        updated_at: now,
      };
      if (p.call_control_id) {
        await supabase
          .from("telnyx_calls")
          .update(patch)
          .eq("call_control_id", p.call_control_id);
      } else {
        const row = await findRow(supabase, p);
        if (row)
          await supabase.from("telnyx_calls").update(patch).eq("id", row.id);
      }
      break;
    }

    default:
      // outros eventos (call.bridged, dtmf, etc.) não precisam de log por ora
      break;
  }
}
