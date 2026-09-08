import { describe, it, expect } from "vitest";
import { proximoRetorno, dentroDaJanela, partesNoFuso } from "./schedule";

const JANELA = { inicio: "09:00", fim: "19:00" }; // seg-sex, America/Sao_Paulo

/** Helper: hora de parede em São Paulo (UTC-3) como Date. */
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("proximoRetorno", () => {
  it("sem janela, é só somar o tempo", () => {
    const agora = sp("2026-09-08T14:00:00");
    expect(proximoRetorno(agora, { dias: 1 }).toISOString()).toBe(
      sp("2026-09-09T14:00:00").toISOString(),
    );
  });

  it("caindo dentro do expediente, não mexe", () => {
    // terça 14h + 1 dia = quarta 14h
    const r = proximoRetorno(sp("2026-09-08T14:00:00"), { dias: 1, janela: JANELA });
    expect(r.toISOString()).toBe(sp("2026-09-09T14:00:00").toISOString());
  });

  it("caindo de madrugada, sobe para a abertura do mesmo dia", () => {
    // terça 23h + 4h = quarta 03h -> quarta 09h
    const r = proximoRetorno(sp("2026-09-08T23:00:00"), { horas: 4, janela: JANELA });
    expect(r.toISOString()).toBe(sp("2026-09-09T09:00:00").toISOString());
  });

  it("caindo depois do fechamento, vai para a abertura do dia seguinte", () => {
    // terça 18h + 3h = terça 21h -> quarta 09h
    const r = proximoRetorno(sp("2026-09-08T18:00:00"), { horas: 3, janela: JANELA });
    expect(r.toISOString()).toBe(sp("2026-09-09T09:00:00").toISOString());
  });

  it("caindo no sábado, pula para segunda", () => {
    // sexta 11/set 14h + 1 dia = sábado 14h -> segunda 09h
    const r = proximoRetorno(sp("2026-09-11T14:00:00"), { dias: 1, janela: JANELA });
    expect(r.toISOString()).toBe(sp("2026-09-14T09:00:00").toISOString());
  });

  it("respeita dias_semana customizado", () => {
    // só quartas (3): terça 14h + 1h = terça 15h -> quarta 09h
    const r = proximoRetorno(sp("2026-09-08T14:00:00"), {
      horas: 1,
      janela: { ...JANELA, dias_semana: [3] },
    });
    expect(r.toISOString()).toBe(sp("2026-09-09T09:00:00").toISOString());
  });
});

describe("dentroDaJanela", () => {
  it("é idempotente para instante já válido", () => {
    const dentro = sp("2026-09-09T10:30:00");
    expect(dentroDaJanela(dentro, JANELA).toISOString()).toBe(dentro.toISOString());
  });

  it("o fechamento é exclusivo: 19:00 em ponto já é o dia seguinte", () => {
    const r = dentroDaJanela(sp("2026-09-09T19:00:00"), JANELA);
    expect(r.toISOString()).toBe(sp("2026-09-10T09:00:00").toISOString());
  });
});

describe("partesNoFuso", () => {
  it("lê o relógio de parede de São Paulo, não o UTC", () => {
    // 2026-09-09T01:00Z = 2026-09-08 22:00 em SP (terça)
    const p = partesNoFuso(new Date("2026-09-09T01:00:00Z"), "America/Sao_Paulo");
    expect([p.dia, p.hora, p.diaSemana]).toEqual([8, 22, 2]);
  });

  it("meia-noite vira 0, não 24", () => {
    const p = partesNoFuso(new Date("2026-09-09T03:00:00Z"), "America/Sao_Paulo");
    expect(p.hora).toBe(0);
  });
});
