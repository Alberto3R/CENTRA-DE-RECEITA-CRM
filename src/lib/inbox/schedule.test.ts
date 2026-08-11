import { describe, expect, it } from "vitest";

import { formatScheduleLabel, renderTemplateBody } from "./schedule";

describe("renderTemplateBody", () => {
  it("substitui os placeholders na ordem", () => {
    expect(renderTemplateBody("Oi, {{1}}! Sobre {{2}}.", ["João", "a proposta"])).toBe(
      "Oi, João! Sobre a proposta.",
    );
  });

  it("mantém o placeholder quando falta valor, em vez de apagar", () => {
    expect(renderTemplateBody("Oi, {{1}}! Sobre {{2}}.", ["João"])).toBe(
      "Oi, João! Sobre {{2}}.",
    );
    expect(renderTemplateBody("Oi, {{1}}!", ["   "])).toBe("Oi, {{1}}!");
  });

  it("repete o mesmo valor quando o placeholder aparece duas vezes", () => {
    expect(renderTemplateBody("{{1}}, confirma? — {{1}}", ["Ana"])).toBe(
      "Ana, confirma? — Ana",
    );
  });

  it("não mexe em corpo sem variável", () => {
    expect(renderTemplateBody("Bom dia!", [])).toBe("Bom dia!");
  });
});

describe("formatScheduleLabel", () => {
  const now = new Date("2026-08-11T12:00:00Z");

  it("minutos, horas e dias", () => {
    expect(formatScheduleLabel("2026-08-11T12:30:00Z", now)).toBe("em 30 min");
    expect(formatScheduleLabel("2026-08-11T18:00:00Z", now)).toBe("em 6h");
    expect(formatScheduleLabel("2026-08-14T12:00:00Z", now)).toBe("em 3 dias");
  });

  it("amanhã no singular", () => {
    expect(formatScheduleLabel("2026-08-12T12:00:00Z", now)).toBe("amanhã");
  });

  it("horário já vencido vira 'enviando…'", () => {
    expect(formatScheduleLabel("2026-08-11T11:59:00Z", now)).toBe("enviando…");
  });
});
