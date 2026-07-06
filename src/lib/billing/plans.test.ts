import { describe, it, expect } from "vitest";

import { PLANS, getPlan, isPlanId } from "./plans";

describe("billing/plans", () => {
  it("reconhece ids de plano válidos", () => {
    expect(isPlanId("free")).toBe(true);
    expect(isPlanId("starter")).toBe(true);
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("enterprise")).toBe(true);
    expect(isPlanId("gold")).toBe(false);
    expect(isPlanId(null)).toBe(false);
  });

  it("cai no trial (free) para id desconhecido/nulo", () => {
    expect(getPlan(null).id).toBe("free");
    expect(getPlan("inexistente").id).toBe("free");
    expect(getPlan("starter").id).toBe("starter");
  });

  it("Starter = 200 créditos / Pro = 500 / Enterprise = ilimitado", () => {
    expect(PLANS.starter.creditosMes).toBe(200);
    expect(PLANS.pro.creditosMes).toBe(500);
    expect(PLANS.enterprise.creditosMes).toBeLessThan(0);
  });

  it("preços e usuários inclusos batem com a oferta", () => {
    expect(PLANS.starter.precoMensalReais).toBe(497);
    expect(PLANS.starter.precoAnualMensalReais).toBe(397);
    expect(PLANS.starter.usuariosInclusos).toBe(3);
    expect(PLANS.pro.precoMensalReais).toBe(927);
    expect(PLANS.pro.usuariosInclusos).toBe(5);
    expect(PLANS.pro.precoUsuarioAdicionalReais).toBe(197);
  });
});
