import { describe, expect, it } from "vitest";

import { dentroDoIntervalo, rotuloDoIntervalo } from "./date-range-picker";

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe("rotuloDoIntervalo", () => {
  it("mostra o placeholder sem intervalo", () => {
    expect(rotuloDoIntervalo({ from: null, to: null }, "Datas")).toBe("Datas");
  });

  it("mostra as duas pontas", () => {
    expect(
      rotuloDoIntervalo({ from: d("2026-09-01"), to: d("2026-09-30") }),
    ).toBe("01/09/26 – 30/09/26");
  });

  it("colapsa quando as pontas são o mesmo dia", () => {
    expect(
      rotuloDoIntervalo({ from: d("2026-09-02"), to: d("2026-09-02") }),
    ).toBe("02/09/26");
  });

  it("descreve intervalo aberto de um lado só", () => {
    expect(rotuloDoIntervalo({ from: d("2026-09-02"), to: null })).toBe(
      "A partir de 02/09/26",
    );
    expect(rotuloDoIntervalo({ from: null, to: d("2026-09-02") })).toBe(
      "Até 02/09/26",
    );
  });
});

describe("dentroDoIntervalo", () => {
  const intervalo = { from: d("2026-09-01"), to: d("2026-09-30") };

  it("aceita as bordas — o dia inteiro conta", () => {
    expect(
      dentroDoIntervalo(new Date("2026-09-01T00:00:00"), intervalo),
    ).toBe(true);
    expect(
      dentroDoIntervalo(new Date("2026-09-30T23:59:59"), intervalo),
    ).toBe(true);
  });

  it("recusa fora do intervalo", () => {
    expect(dentroDoIntervalo(d("2026-08-31"), intervalo)).toBe(false);
    expect(dentroDoIntervalo(d("2026-10-01"), intervalo)).toBe(false);
  });

  it("lado nulo fica aberto", () => {
    expect(
      dentroDoIntervalo(d("2020-01-01"), { from: null, to: d("2026-09-30") }),
    ).toBe(true);
    expect(
      dentroDoIntervalo(d("2030-01-01"), { from: d("2026-09-01"), to: null }),
    ).toBe(true);
  });

  it("sem intervalo, tudo passa", () => {
    expect(dentroDoIntervalo(d("2026-09-02"), { from: null, to: null })).toBe(
      true,
    );
  });
});
