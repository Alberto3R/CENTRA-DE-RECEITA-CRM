import { describe, expect, it } from "vitest";

import { prazoVencido } from "./account";

const AGORA = new Date("2026-09-10T12:00:00Z").getTime();

describe("prazoVencido", () => {
  it("conta sem prazo nunca está suspensa", () => {
    expect(prazoVencido(null, { agora: AGORA })).toBe(false);
    expect(prazoVencido(undefined, { agora: AGORA })).toBe(false);
  });

  it("prazo no futuro ainda é só aviso", () => {
    expect(prazoVencido("2026-09-17T12:00:00Z", { agora: AGORA })).toBe(false);
  });

  it("prazo vencido corta", () => {
    expect(prazoVencido("2026-09-09T22:19:00Z", { agora: AGORA })).toBe(true);
  });

  it("corta no instante exato do prazo", () => {
    expect(prazoVencido("2026-09-10T12:00:00Z", { agora: AGORA })).toBe(true);
  });

  it("impersonation nunca é bloqueada — é como a 3R entra para resolver", () => {
    expect(
      prazoVencido("2026-01-01T00:00:00Z", {
        agora: AGORA,
        impersonando: true,
      }),
    ).toBe(false);
  });

  it("data inválida não derruba o acesso", () => {
    expect(prazoVencido("nao-é-data", { agora: AGORA })).toBe(false);
  });
});
