// Serviço de agenda (Google Calendar) — multi-tenant. Resolve o access token da
// CONTA (renova via refresh token e persiste), consulta livre/ocupado, calcula
// os slots livres pelas regras da conta, e cria o evento com Google Meet.

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import { refreshAccessToken } from "./oauth";

const CAL_API = "https://www.googleapis.com/calendar/v3";

export interface SchedulingConfig {
  timezone: string;
  slot_minutes: number;
  buffer_minutes: number;
  advance_days: number;
  business_hours: { days: number[]; start: string; end: string };
}
export interface Slot {
  startISO: string;
  endISO: string;
}

/** Access token válido da conta (renova + persiste se expirado). null se a
 *  conta não tem agenda conectada. */
export async function getAccountCalendar(
  accountId: string,
): Promise<{ accessToken: string; calendarId: string } | null> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("google_connections")
    .select("access_token, refresh_token, token_expires_at, calendar_id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!data?.refresh_token) return null;

  const calendarId = data.calendar_id || "primary";
  const now = Date.now();
  const expMs = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;

  // Ainda válido (margem de 60s)? Usa o access token cifrado.
  if (data.access_token && expMs - 60_000 > now) {
    try {
      return { accessToken: decrypt(data.access_token), calendarId };
    } catch {
      /* cai pro refresh abaixo */
    }
  }

  // Renova.
  const refresh = decrypt(data.refresh_token);
  const fresh = await refreshAccessToken(refresh);
  const newExp = new Date(now + fresh.expires_in * 1000).toISOString();
  await admin
    .from("google_connections")
    .update({
      access_token: encrypt(fresh.access_token),
      token_expires_at: newExp,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId);
  return { accessToken: fresh.access_token, calendarId };
}

/** Intervalos ocupados da agenda entre timeMin e timeMax (ISO). */
export async function freeBusy(
  accessToken: string,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string,
): Promise<{ start: string; end: string }[]> {
  const res = await fetch(`${CAL_API}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) {
    throw new Error(`freeBusy falhou (${res.status}): ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  return data.calendars?.[calendarId]?.busy ?? [];
}

// Instante UTC de uma hora-relógio local (y,m,d,hh,mm) num fuso. Usa Intl para
// achar o offset do fuso naquele instante (lida com horário de verão em geral;
// no Brasil é fixo -3h).
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const asIfUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(asIfUtc));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const localAsUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +(map.second || "0"));
  const offset = localAsUtc - asIfUtc; // quanto o fuso está à frente do UTC
  return new Date(asIfUtc - offset);
}

// Componentes de data (y,m,d,weekday) de um instante num fuso.
function zonedParts(date: Date, tz: string): { y: number; m: number; d: number; wd: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const wdMap: Record<string, number> = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +map.year, m: +map.month, d: +map.day, wd: wdMap[map.weekday] ?? 0 };
}

/** Calcula os próximos slots livres (a partir de `from`) pelas regras da conta,
 *  descontando os intervalos ocupados. Retorna no máx. `limit` slots. */
export function computeSlots(
  cfg: SchedulingConfig,
  busy: { start: string; end: string }[],
  from: Date,
  limit = 4,
): Slot[] {
  const [sh, sm] = cfg.business_hours.start.split(":").map(Number);
  const [eh, em] = cfg.business_hours.end.split(":").map(Number);
  const step = (cfg.slot_minutes + cfg.buffer_minutes) * 60_000;
  const dur = cfg.slot_minutes * 60_000;
  const busyMs = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);
  const overlaps = (s: number, e: number) => busyMs.some(([bs, be]) => s < be && e > bs);

  const slots: Slot[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let dOff = 0; dOff <= cfg.advance_days && slots.length < limit; dOff++) {
    const probe = new Date(from.getTime() + dOff * dayMs);
    const { y, m, d, wd } = zonedParts(probe, cfg.timezone);
    if (!cfg.business_hours.days.includes(wd)) continue;
    const dayStart = zonedToUtc(y, m, d, sh, sm, cfg.timezone).getTime();
    const dayEnd = zonedToUtc(y, m, d, eh, em, cfg.timezone).getTime();
    for (let t = dayStart; t + dur <= dayEnd && slots.length < limit; t += step) {
      if (t < from.getTime()) continue; // não ofertar passado
      if (overlaps(t, t + dur)) continue;
      slots.push({ startISO: new Date(t).toISOString(), endISO: new Date(t + dur).toISOString() });
    }
  }
  return slots;
}

/** Agendas visíveis na conta Google conectada (pra escolher em qual marcar).
 *  Exige escopo de leitura de calendarList (calendar.readonly). Se a conexão foi
 *  autorizada antes desse escopo, o Google devolve 403 — retornamos null e a UI
 *  cai pro modo "digite o ID da agenda". */
export async function listCalendars(
  accountId: string,
): Promise<{ id: string; summary: string; primary: boolean }[] | null> {
  const conn = await getAccountCalendar(accountId);
  if (!conn) return null;
  const res = await fetch(
    `${CAL_API}/users/me/calendarList?minAccessRole=writer&fields=items(id,summary,summaryOverride,primary,accessRole)`,
    { headers: { Authorization: `Bearer ${conn.accessToken}` } },
  );
  if (res.status === 403) return null; // escopo insuficiente → modo manual
  if (!res.ok) throw new Error(`calendarList falhou (${res.status}): ${await res.text().catch(() => "")}`.slice(0, 300));
  const data = (await res.json()) as {
    items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[];
  };
  return (data.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary || c.id,
    primary: !!c.primary,
  }));
}

/** Slots livres da conta prontos pra ofertar (junta getAccountCalendar+freeBusy+computeSlots). */
export async function availableSlots(
  accountId: string,
  cfg: SchedulingConfig,
  limit = 4,
): Promise<Slot[]> {
  const conn = await getAccountCalendar(accountId);
  if (!conn) throw new Error("Agenda Google não conectada nesta conta.");
  const from = new Date();
  const to = new Date(from.getTime() + (cfg.advance_days + 1) * 24 * 60 * 60 * 1000);
  const busy = await freeBusy(conn.accessToken, conn.calendarId, from.toISOString(), to.toISOString());
  return computeSlots(cfg, busy, from, limit);
}

/** Cria o evento com Google Meet e devolve os links. */
export async function createMeetEvent(
  accountId: string,
  cfg: SchedulingConfig,
  args: { startISO: string; endISO: string; summary: string; description?: string; attendeeEmail?: string | null },
): Promise<{ meetLink: string | null; htmlLink: string | null; eventId: string; calendarId: string }> {
  const conn = await getAccountCalendar(accountId);
  if (!conn) throw new Error("Agenda Google não conectada nesta conta.");

  const body: Record<string, unknown> = {
    summary: args.summary,
    description: args.description ?? "",
    start: { dateTime: args.startISO, timeZone: cfg.timezone },
    end: { dateTime: args.endISO, timeZone: cfg.timezone },
    conferenceData: {
      createRequest: {
        requestId: `augra-${args.startISO}-${Math.floor(Math.random() * 1e6)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };
  if (args.attendeeEmail) body.attendees = [{ email: args.attendeeEmail }];

  const send = args.attendeeEmail ? "all" : "none";
  const res = await fetch(
    `${CAL_API}/calendars/${encodeURIComponent(conn.calendarId)}/events?conferenceDataVersion=1&sendUpdates=${send}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`Falha ao criar evento (${res.status}): ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  const ev = (await res.json()) as { id: string; htmlLink?: string; hangoutLink?: string };
  return { meetLink: ev.hangoutLink ?? null, htmlLink: ev.htmlLink ?? null, eventId: ev.id, calendarId: conn.calendarId };
}
