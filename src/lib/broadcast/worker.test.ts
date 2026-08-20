import { describe, expect, it } from "vitest";
import { isMissingColumnError } from "./worker";

/**
 * Regressão do apagão de 19/ago: o código subiu com `header_media_url` no
 * select antes de a migration rodar. O select falhava, o erro era
 * descartado sem log e todo disparo do CRM parou em silêncio — inclusive
 * a cadência automática, represada por horas.
 */
describe("isMissingColumnError", () => {
  it("reconhece o PGRST204 do PostgREST (schema cache)", () => {
    expect(
      isMissingColumnError({
        code: "PGRST204",
        message:
          "Could not find the 'header_media_url' column of 'broadcasts' in the schema cache",
      }),
    ).toBe(true);
  });

  it("reconhece o 42703 do Postgres", () => {
    expect(
      isMissingColumnError({
        code: "42703",
        message: 'column "header_media_url" does not exist',
      }),
    ).toBe(true);
  });

  it("reconhece pela mensagem quando o código não vem", () => {
    expect(
      isMissingColumnError({
        code: null,
        message: 'column broadcasts.header_media_url does not exist',
      }),
    ).toBe(true);
  });

  it("não confunde com falha de rede ou permissão", () => {
    expect(isMissingColumnError({ code: "42501", message: "permission denied" })).toBe(
      false,
    );
    expect(isMissingColumnError({ code: null, message: "fetch failed" })).toBe(false);
  });

  it("é falso quando não há erro", () => {
    expect(isMissingColumnError(null)).toBe(false);
  });
});
