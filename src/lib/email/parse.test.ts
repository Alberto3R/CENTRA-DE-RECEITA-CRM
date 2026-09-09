import { describe, it, expect } from "vitest";
import {
  normalizarEmail,
  nomeDoRemetente,
  extrairReferencias,
  assuntoLimpo,
  removerCitacao,
  corpoParaInbox,
} from "./parse";

describe("normalizarEmail", () => {
  it("tira o nome de exibição e baixa a caixa", () => {
    expect(normalizarEmail("Fulano da Silva <F.Silva@Empresa.COM>")).toBe(
      "f.silva@empresa.com",
    );
  });
  it("aceita endereço solto", () => {
    expect(normalizarEmail("  Contato@X.com ")).toBe("contato@x.com");
  });
  it("vazio para nulo", () => {
    expect(normalizarEmail(null)).toBe("");
  });
});

describe("nomeDoRemetente", () => {
  it("extrai o nome quando existe", () => {
    expect(nomeDoRemetente('"Ana Clara" <ana@x.com>')).toBe("Ana Clara");
  });
  it("não devolve e-mail como nome", () => {
    expect(nomeDoRemetente("f@x.com <f@x.com>")).toBe("");
  });
  it("vazio quando vem só o endereço", () => {
    expect(nomeDoRemetente("f@x.com")).toBe("");
  });
});

describe("extrairReferencias", () => {
  it("põe o pai direto na frente da linhagem", () => {
    const ids = extrairReferencias("<c@x>", ["<a@x> <b@x>"]);
    expect(ids).toEqual(["<c@x>", "<a@x>", "<b@x>"]);
  });
  it("normaliza id sem os sinais", () => {
    expect(extrairReferencias("abc@x", null)).toEqual(["<abc@x>"]);
  });
  it("não repete id", () => {
    expect(extrairReferencias("<a@x>", "<a@x>")).toEqual(["<a@x>"]);
  });
  it("lista vazia quando não há nada", () => {
    expect(extrairReferencias(null, undefined)).toEqual([]);
  });
});

describe("assuntoLimpo", () => {
  it("tira prefixos empilhados", () => {
    expect(assuntoLimpo("Re: Enc: RE: Proposta")).toBe("Proposta");
  });
  it("mantém assunto normal", () => {
    expect(assuntoLimpo("Proposta comercial")).toBe("Proposta comercial");
  });
});

describe("removerCitacao", () => {
  it("corta no 'Em ... escreveu:'", () => {
    const bruto = [
      "Bom dia, pode ser terça às 10h.",
      "",
      "Em qua., 3 de set. de 2026 às 09:12, Ana <ana@x.com> escreveu:",
      "> Podemos marcar?",
    ].join("\n");
    expect(removerCitacao(bruto)).toBe("Bom dia, pode ser terça às 10h.");
  });

  it("corta no bloco prefixado por >", () => {
    expect(removerCitacao("Fechado.\n\n> texto antigo")).toBe("Fechado.");
  });

  it("corta no 'On ... wrote:'", () => {
    expect(removerCitacao("Yes.\n\nOn Wed, Sep 3, 2026 at 9:12 AM Ana wrote:\n> hi")).toBe("Yes.");
  });

  it("devolve o texto inteiro quando o corte esvaziaria tudo", () => {
    // Resposta escrita ABAIXO da citação: cortar deixaria o balão vazio.
    const so_citacao = "> tudo citado\n> mais citação";
    expect(removerCitacao(so_citacao)).toBe(so_citacao);
  });

  it("não corta mensagem sem citação", () => {
    expect(removerCitacao("Oi, tudo bem?")).toBe("Oi, tudo bem?");
  });
});

describe("corpoParaInbox", () => {
  it("tira citação e assinatura", () => {
    const bruto = [
      "Pode mandar a proposta.",
      "",
      "--",
      "Marcos Silva",
      "Diretor Comercial",
      "",
      "Em ter., 2 de set. de 2026, Ana <ana@x.com> escreveu:",
      "> segue",
    ].join("\n");
    expect(corpoParaInbox(bruto)).toBe("Pode mandar a proposta.");
  });
});
