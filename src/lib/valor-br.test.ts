import { describe, expect, it } from "vitest";
import { parseValorBR, previaValorBR, valorParaCampo } from "./valor-br";

describe("parseValorBR", () => {
  it.each([
    ["13.685", 13685],
    ["13685", 13685],
    ["13.685,00", 13685],
    ["13.685,50", 13685.5],
    ["R$ 13.685,50", 13685.5],
    ["R$13.685", 13685],
    ["1.250.000", 1250000],
    ["1.250.000,99", 1250000.99],
    ["1500,5", 1500.5],
    ["1500,50", 1500.5],
    ["1500.50", 1500.5],
    ["13,685", 13685],
    ["13,685.50", 13685.5],
    ["0,99", 0.99],
    [" 25 990 ", 25990],
    ["-500", -500],
  ])("%s → %s", (entrada, esperado) => {
    expect(parseValorBR(entrada)).toBe(esperado);
  });

  it("devolve null quando não há número", () => {
    expect(parseValorBR("")).toBeNull();
    expect(parseValorBR("   ")).toBeNull();
    expect(parseValorBR("abc")).toBeNull();
    expect(parseValorBR(null)).toBeNull();
    expect(parseValorBR(undefined)).toBeNull();
  });

  it("aceita número já pronto", () => {
    expect(parseValorBR(13685)).toBe(13685);
    expect(parseValorBR(Number.NaN)).toBeNull();
  });
});

describe("valorParaCampo", () => {
  it("usa vírgula decimal e volta ao mesmo número", () => {
    expect(valorParaCampo(13685)).toBe("13685");
    expect(valorParaCampo(13685.5)).toBe("13685,5");
    expect(valorParaCampo("13.69")).toBe("13,69");
    expect(parseValorBR(valorParaCampo(13685.5))).toBe(13685.5);
    expect(parseValorBR(valorParaCampo(13.69))).toBe(13.69);
  });

  it("vazio fica vazio", () => {
    expect(valorParaCampo(null)).toBe("");
    expect(valorParaCampo(undefined)).toBe("");
    expect(valorParaCampo("")).toBe("");
  });
});

describe("previaValorBR", () => {
  it("formata em pt-BR, com centavos só quando há", () => {
    expect(previaValorBR(13685, "BRL").replace(/\s/g, " ")).toBe("R$ 13.685");
    expect(previaValorBR(1500.5, "BRL").replace(/\s/g, " ")).toBe("R$ 1.500,50");
  });
  it("não quebra com moeda inválida", () => {
    expect(previaValorBR(10, "Reais")).toBe("Reais 10");
  });
});
