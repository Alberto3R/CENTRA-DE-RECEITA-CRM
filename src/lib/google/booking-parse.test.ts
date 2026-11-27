import { describe, expect, it } from "vitest";
import {
  matchesTitleFilter,
  extractPhone,
  firstNameOf,
  formatQuando,
  isCancelled,
  meetLinkOf,
  pickBooker,
  reminderTimes,
  type GoogleEvent,
} from "./booking-parse";

const base: GoogleEvent = {
  id: "ev1",
  status: "confirmed",
  organizer: { email: "amanda@sales3r.com.br", self: true },
  attendees: [
    { email: "amanda@sales3r.com.br", self: true, organizer: true, responseStatus: "accepted" },
    { email: "maria.silva@gmail.com", displayName: "Maria Silva", responseStatus: "accepted" },
  ],
};

describe("pickBooker", () => {
  it("devolve o convidado de fora", () => {
    expect(pickBooker(base)?.email).toBe("maria.silva@gmail.com");
  });
  it("evento sem ninguém de fora não é reserva", () => {
    expect(pickBooker({ ...base, attendees: [base.attendees![0]] })).toBeNull();
    expect(pickBooker({ ...base, attendees: undefined })).toBeNull();
  });
  it("ignora sala", () => {
    const ev = { ...base, attendees: [{ email: "sala@resource.calendar.google.com", resource: true }] };
    expect(pickBooker(ev)).toBeNull();
  });
});

describe("isCancelled", () => {
  it("status cancelled", () => {
    expect(isCancelled({ ...base, status: "cancelled" })).toBe(true);
  });
  it("convidado recusou", () => {
    const ev = {
      ...base,
      attendees: [base.attendees![0], { ...base.attendees![1], responseStatus: "declined" }],
    };
    expect(isCancelled(ev)).toBe(true);
  });
  it("reserva normal", () => {
    expect(isCancelled(base)).toBe(false);
  });
});

describe("extractPhone", () => {
  it("lê o campo rotulado do formulário", () => {
    expect(extractPhone("Reservado por\nMaria Silva\nmaria@x.com\nTelefone: (61) 99876-5432")).toBe("61998765432");
    expect(extractPhone("WhatsApp\n+55 11 91234-5678")).toBe("5511912345678");
  });
  it("aceita HTML da descrição", () => {
    expect(extractPhone("<b>Telefone</b><br>61 99876 5432")).toBe("6199876543".concat("2"));
  });
  it("sem rótulo pega o primeiro número com cara de telefone", () => {
    expect(extractPhone("Contato da Maria 11912345678 obrigado")).toBe("11912345678");
  });
  it("não confunde data/hora com telefone", () => {
    expect(extractPhone("Sessão em 25/11 às 15:00")).toBeNull();
    expect(extractPhone(null)).toBeNull();
  });
});

describe("meetLinkOf", () => {
  it("prefere hangoutLink", () => {
    expect(meetLinkOf({ ...base, hangoutLink: "https://meet.google.com/abc-defg-hij" })).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
  });
  it("cai no entryPoint de vídeo", () => {
    const ev = { ...base, conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/1" }] } };
    expect(meetLinkOf(ev)).toBe("https://zoom.us/j/1");
  });
  it("sem sala → null", () => {
    expect(meetLinkOf(base)).toBeNull();
  });
});

describe("firstNameOf", () => {
  it("usa o displayName", () => {
    expect(firstNameOf("MARIA silva")).toBe("Maria");
  });
  it("cai no e-mail", () => {
    expect(firstNameOf(null, "joana.lima88@gmail.com")).toBe("Joana");
  });
  it("sem nada", () => {
    expect(firstNameOf("", "")).toBe("tudo bem");
  });
});

describe("formatQuando (horário de Brasília)", () => {
  // 25/11/2026 é quarta-feira. 18:00Z = 15h em Brasília.
  const start = new Date("2026-11-25T18:00:00Z");
  it("mesmo dia", () => {
    expect(formatQuando(start, new Date("2026-11-25T12:00:00Z"))).toBe("hoje, às 15h");
  });
  it("dia seguinte", () => {
    expect(formatQuando(start, new Date("2026-11-24T18:00:00Z"))).toBe("amanhã, quarta 25/11, às 15h");
  });
  it("mais longe, com minutos", () => {
    expect(formatQuando(new Date("2026-11-27T18:30:00Z"), new Date("2026-11-24T12:00:00Z"))).toBe(
      "sexta, 27/11, às 15h30",
    );
  });
  it("vira o dia por Brasília, não por UTC", () => {
    // 26/11 01:00Z = 25/11 22h em Brasília → ainda é "hoje" para quem recebe às 20h do dia 25.
    expect(formatQuando(new Date("2026-11-26T01:00:00Z"), new Date("2026-11-25T23:00:00Z"))).toBe("hoje, às 22h");
  });
});

describe("reminderTimes", () => {
  const start = new Date("2026-11-25T18:00:00Z");
  it("24h e 1h antes, em ordem", () => {
    const r = reminderTimes(start, [60, 1440], new Date("2026-11-23T12:00:00Z"));
    expect(r.map((d) => d.toISOString())).toEqual(["2026-11-24T18:00:00.000Z", "2026-11-25T17:00:00.000Z"]);
  });
  it("descarta o que já passou ou está a menos de 10 min", () => {
    const r = reminderTimes(start, [1440, 60], new Date("2026-11-25T10:00:00Z"));
    expect(r.map((d) => d.toISOString())).toEqual(["2026-11-25T17:00:00.000Z"]);
    expect(reminderTimes(start, [60], new Date("2026-11-25T16:55:00Z"))).toEqual([]);
  });
  it("sem duplicados", () => {
    expect(reminderTimes(start, [60, 60], new Date("2026-11-23T12:00:00Z"))).toHaveLength(1);
  });
});

describe("matchesTitleFilter", () => {
  it("sem filtro, qualquer título passa", () => {
    expect(matchesTitleFilter("Reunião com fornecedor", null)).toBe(true);
    expect(matchesTitleFilter(undefined, "")).toBe(true);
  });
  it("título da página de agendamento passa", () => {
    expect(matchesTitleFilter("Time Que Vende (Maria Souza)", "Time Que Vende")).toBe(true);
  });
  it("ignora maiúsculas, acentos e espaços extras", () => {
    expect(matchesTitleFilter("SESSÃO  estratégica", "sessao estrategica")).toBe(true);
  });
  it("outra reunião da agenda principal não passa", () => {
    expect(matchesTitleFilter("Call com cliente X", "Time Que Vende")).toBe(false);
    expect(matchesTitleFilter(undefined, "Time Que Vende")).toBe(false);
  });
});
