import { describe, it, expect } from "vitest";

import { CONFIG_3R, DIMENSOES_3R, simboloMoeda } from "./method-config";
import { buildSystemPrompt, SYSTEM_PROMPT_3R } from "./prompts/analise-call-v1";

describe("ai/method-config", () => {
  it("preset 3R tem as 7 dimensões e não é customizado", () => {
    expect(DIMENSOES_3R).toHaveLength(7);
    expect(CONFIG_3R.customizado).toBe(false);
    expect(CONFIG_3R.metodoNome).toBe("3R");
  });

  it("buildSystemPrompt devolve o texto 3R verbatim quando não customizado", () => {
    // Garante zero regressão para a Sales 3R no preset de fábrica.
    expect(buildSystemPrompt(CONFIG_3R)).toBe(SYSTEM_PROMPT_3R);
  });

  it("buildSystemPrompt monta prompt do método quando customizado", () => {
    const prompt = buildSystemPrompt({
      ...CONFIG_3R,
      metodoNome: "SPIN",
      customizado: true,
      moeda: "USD",
    });
    expect(prompt).not.toBe(SYSTEM_PROMPT_3R);
    expect(prompt).toContain("SPIN");
    expect(prompt).toContain("US$");
  });

  it("simboloMoeda mapeia moedas conhecidas e cai no código ISO", () => {
    expect(simboloMoeda("BRL")).toBe("R$");
    expect(simboloMoeda("USD")).toBe("US$");
    expect(simboloMoeda("JPY")).toBe("JPY");
  });
});
