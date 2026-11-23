// Leitura de reservas feitas FORA do CRM (página de agendamento do Google).
//
// Para cada conta com calendar_booking_sync.enabled e agenda conectada
// (google_connections), lê os eventos alterados desde a última passada e:
//   reserva nova     → acha/cria o contato, registra em scheduled_calls
//                      (source 'booking_page'), move o negócio pra etapa de
//                      call marcada do funil, aplica a tag, confirma no
//                      WhatsApp e agenda os lembretes (scheduled_messages);
//   remarcou         → atualiza o horário, troca os lembretes e reconfirma;
//   cancelou         → marca a call cancelada e cancela os lembretes.
// Calls criadas pelo agente (source 'agent') não são tocadas.
//
// Chamado a cada 5 min pelo pg_cron (migration 125) via
// /api/google/booking-sync/process. Idempotente por (account_id,
// google_event_id): reler o mesmo evento não manda nada de novo.

import type { SupabaseClient } from "@supabase/supabase-js";

import { engineSendTemplate } from "@/lib/automations/meta-send";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { advanceDealsOnCallBooked } from "@/lib/pipeline/auto-advance";
import { marcarContatoComTag } from "@/lib/contacts/marcar-tag";
import { resolveChannelConfig } from "@/lib/whatsapp/channel";
import { brPhoneLookupKeys, isValidE164, sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";

import { getAccountCalendar, listChangedEvents } from "./calendar";
import {
  extractPhone,
  firstNameOf,
  formatQuando,
  isCancelled,
  meetLinkOf,
  pickBooker,
  reminderTimes,
  type GoogleEvent,
} from "./booking-parse";

type Admin = SupabaseClient;

interface SyncConfig {
  account_id: string;
  confirm_template: string | null;
  reminder_template: string | null;
  reminder_offsets_min: number[] | null;
  tag_name: string | null;
  handoff_to_human: boolean;
  last_synced_at: string | null;
}

interface CallRow {
  id: string;
  source: string;
  status: string;
  starts_at: string;
  contact_id: string | null;
  conversation_id: string | null;
}

export interface BookingSyncResult {
  accounts: number;
  events: number;
  outcomes: Record<string, number>;
  errors: string[];
}

/** Primeira passada olha 2 dias pra trás; depois, desde a última (com folga). */
const PRIMEIRA_JANELA_MS = 2 * 24 * 60 * 60_000;
const FOLGA_MS = 10 * 60_000;
const SEM_LINK = "enviado no seu e-mail";

export async function processBookingSync(): Promise<BookingSyncResult> {
  const admin = supabaseAdmin();
  const result: BookingSyncResult = { accounts: 0, events: 0, outcomes: {}, errors: [] };

  const { data: configs, error } = await admin
    .from("calendar_booking_sync")
    .select(
      "account_id, confirm_template, reminder_template, reminder_offsets_min, tag_name, handoff_to_human, last_synced_at",
    )
    .eq("enabled", true);
  if (error) {
    result.errors.push(`config: ${error.message}`);
    return result;
  }

  for (const cfg of (configs ?? []) as SyncConfig[]) {
    result.accounts++;
    const startedAt = new Date();
    try {
      const conn = await getAccountCalendar(cfg.account_id);
      if (!conn) throw new Error("Agenda Google não conectada nesta conta.");

      const desde = cfg.last_synced_at
        ? new Date(new Date(cfg.last_synced_at).getTime() - FOLGA_MS)
        : new Date(startedAt.getTime() - PRIMEIRA_JANELA_MS);
      const events = await listChangedEvents(conn.accessToken, conn.calendarId, desde.toISOString());
      result.events += events.length;

      for (const ev of events) {
        let outcome: string;
        try {
          outcome = await handleEvent(admin, cfg, conn.calendarId, ev, startedAt);
        } catch (e) {
          outcome = "error";
          result.errors.push(`${cfg.account_id}/${ev.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
        result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1;
      }

      await admin
        .from("calendar_booking_sync")
        .update({ last_synced_at: startedAt.toISOString(), last_error: null, updated_at: new Date().toISOString() })
        .eq("account_id", cfg.account_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${cfg.account_id}: ${msg}`);
      // Não avança last_synced_at: a próxima passada relê a mesma janela.
      await admin
        .from("calendar_booking_sync")
        .update({ last_error: msg.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("account_id", cfg.account_id);
    }
  }
  return result;
}

async function handleEvent(
  admin: Admin,
  cfg: SyncConfig,
  calendarId: string,
  ev: GoogleEvent,
  now: Date,
): Promise<string> {
  const { data: existingRow } = await admin
    .from("scheduled_calls")
    .select("id, source, status, starts_at, contact_id, conversation_id")
    .eq("account_id", cfg.account_id)
    .eq("google_event_id", ev.id)
    .maybeSingle();
  const existing = existingRow as CallRow | null;

  // Call do agente: ele já confirmou pela conversa.
  if (existing && existing.source !== "booking_page") return "skipped_agent_call";

  if (isCancelled(ev)) {
    if (!existing || existing.status === "cancelled") return "skipped_cancelled";
    await admin
      .from("scheduled_calls")
      .update({ status: "cancelled", updated_at: now.toISOString() })
      .eq("id", existing.id);
    await cancelarLembretes(admin, existing.id);
    return "cancelled";
  }

  const startISO = ev.start?.dateTime;
  const endISO = ev.end?.dateTime;
  if (!startISO || !endISO) return "skipped_all_day";
  const booker = pickBooker(ev);
  if (!booker?.email) return "skipped_not_a_booking";
  const start = new Date(startISO);
  if (start.getTime() <= now.getTime()) return "skipped_past";

  const meetLink = meetLinkOf(ev);

  // ── Remarcação ou só uma edição qualquer do evento ──
  if (existing) {
    const mudouHorario = new Date(existing.starts_at).getTime() !== start.getTime();
    const voltou = existing.status === "cancelled";
    await admin
      .from("scheduled_calls")
      .update({
        starts_at: startISO,
        ends_at: endISO,
        meet_link: meetLink,
        html_link: ev.htmlLink ?? null,
        status: "scheduled",
        updated_at: now.toISOString(),
      })
      .eq("id", existing.id);
    if (!mudouHorario && !voltou) return "unchanged";
    await cancelarLembretes(admin, existing.id);
    if (existing.contact_id && existing.conversation_id) {
      await avisar(admin, cfg, {
        callId: existing.id,
        contactId: existing.contact_id,
        conversationId: existing.conversation_id,
        nome: booker.displayName ?? null,
        email: booker.email,
        start,
        meetLink,
        now,
      });
    }
    return "rescheduled";
  }

  // ── Reserva nova ──
  const phone = extractPhone(ev.description);
  const contactId = await acharOuCriarContato(admin, cfg.account_id, {
    email: booker.email,
    nome: booker.displayName ?? null,
    phone,
  });

  const channel = await resolveChannelConfig(admin, cfg.account_id);
  const conversationId =
    contactId && channel ? await acharOuCriarConversa(admin, cfg.account_id, contactId, channel.id) : null;

  const { data: call, error: callErr } = await admin
    .from("scheduled_calls")
    .insert({
      account_id: cfg.account_id,
      contact_id: contactId,
      conversation_id: conversationId,
      channel_id: channel?.id ?? null,
      google_event_id: ev.id,
      calendar_id: calendarId,
      meet_link: meetLink,
      html_link: ev.htmlLink ?? null,
      summary: ev.summary ?? null,
      attendee_email: booker.email,
      attendee_name: booker.displayName ?? null,
      attendee_phone: phone,
      starts_at: startISO,
      ends_at: endISO,
      status: "scheduled",
      source: "booking_page",
    })
    .select("id")
    .single();
  if (callErr || !call) {
    // Corrida com outra passada (índice único): a outra já cuidou.
    if (callErr?.code === "23505") return "skipped_duplicate";
    throw new Error(`scheduled_calls: ${callErr?.message ?? "insert falhou"}`);
  }

  if (!contactId) return "booked_no_contact";

  await advanceDealsOnCallBooked(admin, cfg.account_id, contactId);
  if (cfg.tag_name) {
    const ownerId = await donoDaConta(admin, cfg.account_id);
    const tagId = ownerId ? await acharOuCriarTag(admin, cfg.account_id, ownerId, cfg.tag_name) : null;
    await marcarContatoComTag(admin, cfg.account_id, contactId, tagId);
  }

  if (!conversationId) return "booked_no_channel";
  return avisar(admin, cfg, {
    callId: (call as { id: string }).id,
    contactId,
    conversationId,
    nome: booker.displayName ?? null,
    email: booker.email,
    start,
    meetLink,
    now,
  });
}

/** Confirmação agora + lembretes agendados. Devolve o desfecho. */
async function avisar(
  admin: Admin,
  cfg: SyncConfig,
  a: {
    callId: string;
    contactId: string;
    conversationId: string;
    nome: string | null;
    email: string;
    start: Date;
    meetLink: string | null;
    now: Date;
  },
): Promise<string> {
  const { data: contact } = await admin.from("contacts").select("name, phone").eq("id", a.contactId).maybeSingle();
  const c = contact as { name?: string | null; phone?: string | null } | null;
  if (!c?.phone || !isValidE164(sanitizePhoneForMeta(c.phone))) return "booked_no_phone";

  const primeiro = firstNameOf(c.name || a.nome, a.email);
  const link = a.meetLink ?? SEM_LINK;
  let outcome = "booked";

  const confirm = cfg.confirm_template ? await templateAprovado(admin, cfg.account_id, cfg.confirm_template) : null;
  if (confirm) {
    const params = [primeiro, formatQuando(a.start, a.now), link];
    await engineSendTemplate({
      accountId: cfg.account_id,
      userId: "",
      conversationId: a.conversationId,
      contactId: a.contactId,
      templateName: confirm.name,
      language: confirm.language,
      params,
      contentText: renderizar(confirm.body_text, params),
    });
    await admin
      .from("scheduled_calls")
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq("id", a.callId);
    outcome = "booked_confirmed";
  } else if (cfg.confirm_template) {
    outcome = "booked_confirm_template_not_approved";
  }

  const reminder = cfg.reminder_template ? await templateAprovado(admin, cfg.account_id, cfg.reminder_template) : null;
  if (reminder) {
    const linhas = reminderTimes(a.start, cfg.reminder_offsets_min ?? [1440, 60], a.now).map((at) => {
      const params = [primeiro, formatQuando(a.start, at), link];
      return {
        account_id: cfg.account_id,
        conversation_id: a.conversationId,
        contact_id: a.contactId,
        template_name: reminder.name,
        template_language: reminder.language,
        template_params: params,
        preview: renderizar(reminder.body_text, params),
        scheduled_at: at.toISOString(),
        status: "pending",
        scheduled_call_id: a.callId,
      };
    });
    if (linhas.length) {
      const { error } = await admin.from("scheduled_messages").insert(linhas);
      if (error) throw new Error(`lembretes: ${error.message}`);
    }
  }

  // A sessão precisa de gente antes dela: a conversa sai da IA e vai pro time.
  if (cfg.handoff_to_human) {
    await admin
      .from("conversations")
      .update({ ai_handoff: true, updated_at: new Date().toISOString() })
      .eq("id", a.conversationId);
  }
  return outcome;
}

async function cancelarLembretes(admin: Admin, callId: string) {
  await admin
    .from("scheduled_messages")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("scheduled_call_id", callId)
    .eq("status", "pending");
}

async function templateAprovado(
  admin: Admin,
  accountId: string,
  name: string,
): Promise<{ name: string; language: string; body_text: string | null } | null> {
  const { data } = await admin
    .from("message_templates")
    .select("name, language, body_text, status")
    .eq("account_id", accountId)
    .eq("name", name)
    .eq("status", "APPROVED")
    .limit(1)
    .maybeSingle();
  const t = data as { name: string; language: string | null; body_text: string | null } | null;
  return t ? { name: t.name, language: t.language || "pt_BR", body_text: t.body_text } : null;
}

/** Corpo do template com os parâmetros, pro balão do inbox não ficar vazio. */
export function renderizar(body: string | null, params: string[]): string | null {
  if (!body) return null;
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
}

async function donoDaConta(admin: Admin, accountId: string): Promise<string | null> {
  const { data } = await admin.from("accounts").select("owner_user_id").eq("id", accountId).maybeSingle();
  return (data as { owner_user_id?: string } | null)?.owner_user_id ?? null;
}

/**
 * Contato da reserva: por e-mail (o que a página de agendamento sempre tem),
 * depois pelo telefone do formulário. Sem nenhum dos dois casando, cria —
 * mas só se veio telefone (contato sem telefone não recebe WhatsApp).
 */
async function acharOuCriarContato(
  admin: Admin,
  accountId: string,
  p: { email: string; nome: string | null; phone: string | null },
): Promise<string | null> {
  const { data: porEmail } = await admin
    .from("contacts")
    .select("id, phone")
    .eq("account_id", accountId)
    .ilike("email", p.email)
    .limit(1)
    .maybeSingle();
  if (porEmail) return (porEmail as { id: string }).id;

  const keys = p.phone ? brPhoneLookupKeys(p.phone) : [];
  if (keys.length) {
    const { data: rows } = await admin
      .from("contacts")
      .select("id, email, phone_normalized")
      .eq("account_id", accountId)
      .in("phone_normalized", keys);
    const lista = (rows ?? []) as { id: string; email: string | null; phone_normalized: string }[];
    lista.sort((x, y) => keys.indexOf(x.phone_normalized) - keys.indexOf(y.phone_normalized));
    const achado = lista[0];
    if (achado) {
      if (!achado.email) await admin.from("contacts").update({ email: p.email }).eq("id", achado.id);
      return achado.id;
    }
  }

  if (!keys.length) return null;
  const ownerId = await donoDaConta(admin, accountId);
  if (!ownerId) return null;
  const { data: criado, error } = await admin
    .from("contacts")
    .insert({ account_id: accountId, user_id: ownerId, phone: keys[0], name: p.nome, email: p.email })
    .select("id")
    .single();
  if (error || !criado) {
    // Corrida de dedup (índice único de telefone): re-busca.
    const { data: again } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .in("phone_normalized", keys)
      .limit(1)
      .maybeSingle();
    return (again as { id: string } | null)?.id ?? null;
  }
  return (criado as { id: string }).id;
}

async function acharOuCriarConversa(
  admin: Admin,
  accountId: string,
  contactId: string,
  channelId: string,
): Promise<string | null> {
  const achar = async () => {
    const { data } = await admin
      .from("conversations")
      .select("id")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .eq("channel_id", channelId)
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };
  const existente = await achar();
  if (existente) return existente;
  const ownerId = await donoDaConta(admin, accountId);
  if (!ownerId) return null;
  const { data: criada } = await admin
    .from("conversations")
    .insert({ account_id: accountId, user_id: ownerId, contact_id: contactId, channel_id: channelId })
    .select("id")
    .single();
  return (criada as { id: string } | null)?.id ?? (await achar());
}

async function acharOuCriarTag(admin: Admin, accountId: string, ownerId: string, nome: string): Promise<string | null> {
  const achar = async () => {
    const { data } = await admin
      .from("tags")
      .select("id")
      .eq("account_id", accountId)
      .ilike("name", nome)
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };
  const existente = await achar();
  if (existente) return existente;
  const { data: criada } = await admin
    .from("tags")
    .insert({ account_id: accountId, user_id: ownerId, name: nome, color: "#22c55e" })
    .select("id")
    .single();
  return (criada as { id: string } | null)?.id ?? (await achar());
}
