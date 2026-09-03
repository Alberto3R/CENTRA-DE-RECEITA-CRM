import { describe, expect, it } from "vitest";

import { partesDaContagem, textoDaContagem } from "./subscription-banner";

const SEG = 1000;
const MIN = 60 * SEG;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

describe("partesDaContagem", () => {
  it("quebra o intervalo em dias/horas/minutos/segundos", () => {
    expect(partesDaContagem(2 * DIA + 3 * HORA + 4 * MIN + 5 * SEG)).toEqual({
      dias: 2,
      horas: 3,
      minutos: 4,
      segundos: 5,
    });
  });

  it("nunca volta valor negativo (prazo já vencido)", () => {
    expect(partesDaContagem(-5 * DIA)).toEqual({
      dias: 0,
      horas: 0,
      minutos: 0,
      segundos: 0,
    });
  });
});

describe("textoDaContagem", () => {
  it("acima de um dia mostra dias e horas, sem segundo", () => {
    expect(textoDaContagem(6 * DIA + 3 * HORA + 40 * MIN)).toBe("6 dias e 3h");
  });

  it("no singular concorda e detalha os minutos", () => {
    expect(textoDaContagem(1 * DIA + 2 * HORA + 7 * MIN)).toBe(
      "1 dia e 2h 07min",
    );
  });

  it("no último dia vira relógio, com segundos", () => {
    expect(textoDaContagem(5 * HORA + 12 * MIN + 44 * SEG)).toBe("05:12:44");
  });

  it("zera no vencimento", () => {
    expect(textoDaContagem(0)).toBe("00:00:00");
  });
});
