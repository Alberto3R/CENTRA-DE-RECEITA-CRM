import { describe, expect, it } from "vitest";

import {
  applyQuickReply,
  filterQuickReplies,
  findSlashQuery,
  normalizeShortcut,
} from "./quick-replies";

describe("normalizeShortcut", () => {
  it("tira a barra, espaços e caixa", () => {
    expect(normalizeShortcut("/Orcamento")).toBe("orcamento");
    expect(normalizeShortcut("  bom dia  ")).toBe("bom-dia");
    expect(normalizeShortcut("//dupla")).toBe("dupla");
  });
});

describe("findSlashQuery", () => {
  it("abre no início do texto", () => {
    expect(findSlashQuery("/orc", 4)).toEqual({ start: 0, query: "orc" });
  });

  it("abre depois de um espaço", () => {
    expect(findSlashQuery("oi /orc", 7)).toEqual({ start: 3, query: "orc" });
  });

  it("abre com a barra sozinha (menu completo)", () => {
    expect(findSlashQuery("/", 1)).toEqual({ start: 0, query: "" });
  });

  it("NÃO abre no meio de uma palavra", () => {
    expect(findSlashQuery("https://site.com", 16)).toBeNull();
    expect(findSlashQuery("e/ou", 4)).toBeNull();
  });

  it("fecha quando o cursor passa de um espaço", () => {
    expect(findSlashQuery("/orc pronto", 11)).toBeNull();
  });

  it("respeita a posição do cursor, não o fim do texto", () => {
    expect(findSlashQuery("/orc resto", 4)).toEqual({ start: 0, query: "orc" });
  });

  it("ignora caret fora do intervalo", () => {
    expect(findSlashQuery("/orc", 0)).toBeNull();
    expect(findSlashQuery("/orc", 99)).toBeNull();
  });
});

describe("filterQuickReplies", () => {
  const rows = [
    { shortcut: "orcamento", content: "Segue o orçamento" },
    { shortcut: "bomdia", content: "Bom dia! Tudo bem?" },
    { shortcut: "pix", content: "Nossa chave orcamento é..." },
  ];

  it("devolve tudo com query vazia", () => {
    expect(filterQuickReplies(rows, "")).toHaveLength(3);
  });

  it("prioriza prefixo sobre substring no conteúdo", () => {
    const out = filterQuickReplies(rows, "orc");
    expect(out.map((r) => r.shortcut)).toEqual(["orcamento", "pix"]);
  });

  it("não devolve nada quando ninguém casa", () => {
    expect(filterQuickReplies(rows, "zzz")).toEqual([]);
  });
});

describe("applyQuickReply", () => {
  it("troca o token pelo conteúdo e reposiciona o cursor", () => {
    const text = "oi /orc";
    const slash = findSlashQuery(text, 7)!;
    expect(applyQuickReply(text, slash, 7, "Segue o orçamento")).toEqual({
      text: "oi Segue o orçamento",
      caret: 20,
    });
  });

  it("preserva o que vem depois do cursor", () => {
    const text = "/orc tchau";
    const slash = findSlashQuery(text, 4)!;
    expect(applyQuickReply(text, slash, 4, "Olá")).toEqual({
      text: "Olá tchau",
      caret: 3,
    });
  });
});
