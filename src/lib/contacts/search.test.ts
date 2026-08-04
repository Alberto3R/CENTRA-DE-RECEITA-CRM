import { describe, expect, it } from "vitest";
import { contactSearchFilter, escapeLikeTerm } from "./search";

describe("escapeLikeTerm", () => {
  it("escapa % para que não vire curinga", () => {
    // Sem isso, buscar "50%" casa com todo contato da conta.
    expect(escapeLikeTerm("50%")).toBe("50\\%");
  });

  it("escapa _ (curinga de um caractere)", () => {
    expect(escapeLikeTerm("joao_silva")).toBe("joao\\_silva");
  });

  it("escapa a própria barra invertida antes dos curingas", () => {
    // Se a barra não fosse escapada primeiro, "\%" viraria "\%" de novo e o
    // % continuaria atuando como curinga.
    expect(escapeLikeTerm("a\\b")).toBe("a\\\\b");
  });

  it("deixa texto comum intacto", () => {
    expect(escapeLikeTerm("João da Silva")).toBe("João da Silva");
    expect(escapeLikeTerm("+55 11 99999-0000")).toBe("+55 11 99999-0000");
  });
});

describe("contactSearchFilter", () => {
  it("busca em nome, telefone, e-mail e @ do Instagram", () => {
    expect(contactSearchFilter("ana")).toBe(
      "name.ilike.%ana%,phone.ilike.%ana%,email.ilike.%ana%,instagram_username.ilike.%ana%",
    );
  });

  it("devolve null para termo vazio ou só espaços", () => {
    // null = "não filtre"; a UI cai na lista de contatos recentes.
    expect(contactSearchFilter("")).toBeNull();
    expect(contactSearchFilter("   ")).toBeNull();
  });

  it("ignora espaços nas pontas", () => {
    expect(contactSearchFilter("  ana  ")).toContain("name.ilike.%ana%");
  });

  it("aplica o escape em todas as colunas", () => {
    const filter = contactSearchFilter("100%");
    expect(filter).toBe(
      "name.ilike.%100\\%%,phone.ilike.%100\\%%,email.ilike.%100\\%%,instagram_username.ilike.%100\\%%",
    );
  });
});
