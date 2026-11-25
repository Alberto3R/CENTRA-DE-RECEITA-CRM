import { describe, expect, it } from "vitest";
import { canManageAgenda } from "./roles";
import { canOpenSection, SETTINGS_SECTIONS } from "@/components/settings/settings-sections";

describe("canManageAgenda", () => {
  it("admin e owner sempre podem, com qualquer função", () => {
    expect(canManageAgenda("owner", null)).toBe(true);
    expect(canManageAgenda("admin", "gestor")).toBe(true);
  });
  it("agente com função closer pode", () => {
    expect(canManageAgenda("agent", "closer")).toBe(true);
  });
  it("agente sem função NÃO pode (null não conta como closer aqui)", () => {
    expect(canManageAgenda("agent", null)).toBe(false);
    expect(canManageAgenda("agent", undefined)).toBe(false);
  });
  it("agente SDR / social seller não pode", () => {
    expect(canManageAgenda("agent", "sdr")).toBe(false);
    expect(canManageAgenda("agent", "social_seller")).toBe(false);
  });
  it("viewer nunca pode, nem como closer", () => {
    expect(canManageAgenda("viewer", "closer")).toBe(false);
  });
});

describe("canOpenSection", () => {
  const closer = { canManage: false, canManageAgenda: true };
  const agente = { canManage: false, canManageAgenda: false };
  const admin = { canManage: true, canManageAgenda: true };

  it("a closer abre a Agenda e as seções pessoais", () => {
    expect(canOpenSection("agenda", closer)).toBe(true);
    expect(canOpenSection("profile", closer)).toBe(true);
  });
  it("a closer continua sem as outras seções de admin", () => {
    for (const s of ["whatsapp", "members", "templates", "ai-agent", "api", "billing"] as const) {
      expect(canOpenSection(s, closer)).toBe(false);
    }
  });
  it("agente comum não abre a Agenda", () => {
    expect(canOpenSection("agenda", agente)).toBe(false);
  });
  it("admin abre tudo", () => {
    for (const s of SETTINGS_SECTIONS) expect(canOpenSection(s, admin)).toBe(true);
  });
});
