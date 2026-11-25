// Leitura de um evento do Google Calendar como RESERVA de alguém de fora.
//
// Funções puras (sem rede, sem banco) para o worker de booking-sync:
// quem reservou, telefone informado no formulário, link da sala, e os
// textos de data que entram nos templates do WhatsApp.

export interface GoogleAttendee {
  email?: string;
  displayName?: string;
  self?: boolean;
  organizer?: boolean;
  resource?: boolean;
  responseStatus?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: GoogleAttendee[];
  organizer?: { email?: string; self?: boolean };
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

/**
 * Quem reservou: o primeiro convidado que não é a dona da agenda, nem o
 * organizador, nem uma sala. Evento sem ninguém de fora (bloqueio, almoço)
 * não é reserva → null.
 */
export function pickBooker(ev: GoogleEvent): GoogleAttendee | null {
  const organizerEmail = ev.organizer?.email?.toLowerCase();
  const externos = (ev.attendees ?? []).filter(
    (a) =>
      !a.self &&
      !a.organizer &&
      !a.resource &&
      !!a.email &&
      a.email.toLowerCase() !== organizerEmail,
  );
  return externos[0] ?? null;
}

/** Reserva desfeita: evento cancelado ou todo mundo de fora recusou. */
export function isCancelled(ev: GoogleEvent): boolean {
  if (ev.status === "cancelled") return true;
  const organizerEmail = ev.organizer?.email?.toLowerCase();
  const externos = (ev.attendees ?? []).filter(
    (a) => !a.self && !a.organizer && !a.resource && a.email?.toLowerCase() !== organizerEmail,
  );
  return externos.length > 0 && externos.every((a) => a.responseStatus === "declined");
}

/**
 * Telefone que a pessoa digitou no formulário da página de agendamento.
 * O Google grava as respostas na descrição do evento, com rótulo
 * ("Telefone", "WhatsApp", "Celular", "Phone"). Sem rótulo, aceita o
 * primeiro número com cara de celular/fixo BR (10 a 13 dígitos).
 * Devolve só os dígitos, ou null.
 */
export function extractPhone(description: string | null | undefined): string | null {
  if (!description) return null;
  const text = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");

  const rotulado = text.match(
    /(?:telefone|whats\s?app|celular|phone|fone|contato)\s*[:\-–]?\s*\n?\s*(\+?[\d\s().\-]{10,22})/i,
  );
  const candidato = rotulado?.[1] ?? text.match(/\+?\d[\d\s().\-]{8,20}\d/)?.[0];
  if (!candidato) return null;
  const digits = candidato.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

/** Link da sala: Meet do evento, ou o primeiro ponto de entrada de vídeo. */
export function meetLinkOf(ev: GoogleEvent): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  const video = ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video");
  return video?.uri ?? null;
}

/** Primeiro nome do convidado (displayName, senão a parte local do e-mail). */
export function firstNameOf(name: string | null | undefined, email?: string | null): string {
  const base = (name ?? "").trim() || (email ?? "").split("@")[0].replace(/[._\d]+/g, " ").trim();
  const first = base.split(/\s+/)[0] ?? "";
  if (!first) return "tudo bem";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const TZ = "America/Sao_Paulo";

function partes(d: Date) {
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return {
    weekday: String(p.weekday).replace("-feira", ""),
    dia: `${p.day}/${p.month}`,
    hora: p.minute === "00" ? `${Number(p.hour)}h` : `${Number(p.hour)}h${p.minute}`,
    ymd,
  };
}

function diasEntre(aYmd: string, bYmd: string): number {
  return Math.round((Date.parse(bYmd) - Date.parse(aYmd)) / 86_400_000);
}

/**
 * Data da sessão por extenso, relativa ao momento em que a mensagem sai:
 *   mesmo dia  → "hoje, às 15h"
 *   dia seguinte → "amanhã, quarta 26/11, às 15h30"
 *   depois     → "quinta, 27/11, às 15h"
 */
export function formatQuando(start: Date, sentAt: Date): string {
  const s = partes(start);
  const n = partes(sentAt);
  const dias = diasEntre(n.ymd, s.ymd);
  if (dias === 0) return `hoje, às ${s.hora}`;
  if (dias === 1) return `amanhã, ${s.weekday} ${s.dia}, às ${s.hora}`;
  return `${s.weekday}, ${s.dia}, às ${s.hora}`;
}

/**
 * Horários dos lembretes: início menos cada offset (minutos). Descarta o
 * que já passou ou cairia em menos de 10 min — um lembrete "amanhã" que
 * chega 5 min depois da confirmação só confunde.
 */
export function reminderTimes(start: Date, offsetsMin: number[], now: Date): Date[] {
  const limite = now.getTime() + 10 * 60_000;
  const vistos = new Set<number>();
  return offsetsMin
    .map((m) => new Date(start.getTime() - m * 60_000))
    .filter((d) => d.getTime() > limite && !vistos.has(d.getTime()) && vistos.add(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
}

/**
 * A agenda conectada costuma ser a principal da pessoa, com outras reuniões
 * que também têm convidado de fora. Com `filtro` preenchido, só conta como
 * reserva o evento cujo título contém esse texto (sem diferenciar maiúsculas
 * nem acentos) — a página de agendamento do Google põe o nome dela no título.
 * Filtro vazio/null = qualquer evento com convidado externo (comportamento antigo).
 */
export function matchesTitleFilter(
  summary: string | null | undefined,
  filtro: string | null | undefined,
): boolean {
  const alvo = norm(filtro);
  if (!alvo) return true;
  return norm(summary).includes(alvo);
}

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
