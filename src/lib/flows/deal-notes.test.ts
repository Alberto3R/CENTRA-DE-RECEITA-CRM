import { describe, it, expect } from "vitest";
import { extrairNotaDoNegocio } from "./deal-notes";

const NOTAS = [
  "Origem: Diagnóstico do Comercial (anúncio Vendedor Sem Controle)",
  "Índice: 42/100 — Vendedor Sem Controle",
  "Vazamento estimado: R$ 38.000 /mês",
  "Maiores buracos: Sem follow-up · Sem CRM · Sem meta",
  "PDF do diagnóstico: https://exemplo.com/diag/joao-1a2b3c.pdf",
].join("\n");

describe("extrairNotaDoNegocio", () => {
  it("pega o valor da linha rotulada", () => {
    expect(extrairNotaDoNegocio(NOTAS, "PDF do diagnóstico")).toBe(
      "https://exemplo.com/diag/joao-1a2b3c.pdf",
    );
  });

  it("de uma lista, devolve só o primeiro item", () => {
    expect(extrairNotaDoNegocio(NOTAS, "Maiores buracos")).toBe("Sem follow-up");
  });

  it("acha o rótulo sem depender de maiúscula", () => {
    expect(extrairNotaDoNegocio(NOTAS, "índice")).toBe("42/100 — Vendedor Sem Controle");
  });

  it("rótulo ausente devolve vazio — nunca o texto inteiro", () => {
    expect(extrairNotaDoNegocio(NOTAS, "Faturamento")).toBe("");
  });

  it("notas vazias ou nulas devolvem vazio", () => {
    expect(extrairNotaDoNegocio(null, "PDF do diagnóstico")).toBe("");
    expect(extrairNotaDoNegocio("", "PDF do diagnóstico")).toBe("");
    expect(extrairNotaDoNegocio(NOTAS, "  ")).toBe("");
  });

  it("caractere de regex no rótulo é tratado como texto", () => {
    // Sem escape, "R$ (mês)" viraria um grupo e o match falharia.
    expect(extrairNotaDoNegocio("R$ (mês): 1200", "R$ (mês)")).toBe("1200");
  });

  it("não confunde o rótulo com o mesmo texto no meio de outra linha", () => {
    const notas = "Obs: falamos sobre PDF do diagnóstico ontem\nPDF do diagnóstico: https://x.com/a.pdf";
    expect(extrairNotaDoNegocio(notas, "PDF do diagnóstico")).toBe("https://x.com/a.pdf");
  });
});
