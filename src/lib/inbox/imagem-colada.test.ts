import { describe, expect, it } from "vitest";
import { imagemDaAreaDeTransferencia } from "./imagem-colada";

function areaDeTransferencia(texto: string, arquivos: File[]): DataTransfer {
  return {
    getData: (tipo: string) => (tipo === "text/plain" ? texto : ""),
    items: arquivos.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
  } as unknown as DataTransfer;
}

const png = new File(["x"], "image.png", { type: "image/png" });

describe("imagemDaAreaDeTransferencia", () => {
  it("devolve a imagem copiada de um site", () => {
    expect(imagemDaAreaDeTransferencia(areaDeTransferencia("", [png]))).toBe(png);
  });

  it("prefere o texto quando vem junto (Word/Excel copiam uma foto do trecho)", () => {
    expect(imagemDaAreaDeTransferencia(areaDeTransferencia("Olá", [png]))).toBeNull();
  });

  it("ignora arquivo que não é imagem", () => {
    const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
    expect(imagemDaAreaDeTransferencia(areaDeTransferencia("", [pdf]))).toBeNull();
  });

  it("aguenta área de transferência vazia", () => {
    expect(imagemDaAreaDeTransferencia(null)).toBeNull();
  });
});
