import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O que estes testes protegem: as duas formas de a impersonation
 * conceder acesso indevido do lado da aplicação.
 *
 *   1. Falha de infraestrutura virando permissão. Se ler
 *      `platform_admins` estourar e o código tratar como "sei lá,
 *      deixa passar", uma queda de banco vira escalada de privilégio.
 *   2. Sessão órfã continuar valendo. Uma linha ativa em
 *      `impersonation_sessions` NÃO pode conceder nada se o ator já
 *      não é platform admin — é assim que revogar um admin derruba as
 *      sessões dele na hora, sem precisar encerrá-las uma a uma.
 *
 * A garantia principal (somente-leitura) não está aqui: está na policy
 * da migration 084, coberta por `policy-invariant.test.ts`. Isto é a
 * segunda camada.
 */

const state: {
  adminRow: unknown;
  adminError: unknown;
  sessionRow: unknown;
  sessionError: unknown;
  throwOnClient: boolean;
} = {
  adminRow: null,
  adminError: null,
  sessionRow: null,
  sessionError: null,
  throwOnClient: false,
};

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => {
    if (state.throwOnClient) {
      // Reproduz o que acontece de verdade quando a service role não
      // está configurada: o construtor do cliente lança.
      throw new Error("supabaseUrl is required.");
    }
    const builder = (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "gt", "order", "limit"]) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = async () =>
        table === "platform_admins"
          ? { data: state.adminRow, error: state.adminError }
          : { data: state.sessionRow, error: state.sessionError };
      return chain;
    };
    return { from: (table: string) => builder(table) };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));

const ACTOR = "actor-uuid";
const SESSION = {
  id: "sess-1",
  actor_user_id: ACTOR,
  target_account_id: "tenant-uuid",
  reason: "chamado #482 investigando entrega",
  started_at: "2026-08-05T10:00:00.000Z",
  expires_at: "2099-01-01T00:00:00.000Z",
};

beforeEach(() => {
  state.adminRow = null;
  state.adminError = null;
  state.sessionRow = null;
  state.sessionError = null;
  state.throwOnClient = false;
});

afterEach(() => {
  vi.resetModules();
});

async function load() {
  return import("./platform-admin");
}

describe("isPlatformAdmin", () => {
  it("é true quando existe linha em platform_admins", async () => {
    state.adminRow = { user_id: ACTOR };
    const { isPlatformAdmin } = await load();
    expect(await isPlatformAdmin(ACTOR)).toBe(true);
  });

  it("é false quando não existe linha", async () => {
    const { isPlatformAdmin } = await load();
    expect(await isPlatformAdmin(ACTOR)).toBe(false);
  });

  it("é false quando a consulta retorna erro", async () => {
    state.adminError = { message: "permission denied" };
    const { isPlatformAdmin } = await load();
    expect(await isPlatformAdmin(ACTOR)).toBe(false);
  });

  it("é false quando o cliente service-role nem inicializa", async () => {
    // Sem isto, uma env faltando derrubaria a checagem com exceção — e
    // um `catch` distraído em algum chamador poderia virar "deixa passar".
    state.throwOnClient = true;
    const { isPlatformAdmin } = await load();
    expect(await isPlatformAdmin(ACTOR)).toBe(false);
  });
});

describe("getActiveImpersonation", () => {
  it("devolve a sessão quando o ator é platform admin", async () => {
    state.adminRow = { user_id: ACTOR };
    state.sessionRow = SESSION;
    const { getActiveImpersonation } = await load();
    const session = await getActiveImpersonation(ACTOR);
    expect(session?.targetAccountId).toBe("tenant-uuid");
    expect(session?.id).toBe("sess-1");
  });

  it("devolve null se o ator não é mais platform admin", async () => {
    // O kill switch. A sessão existe e está no prazo, mas foi revogado:
    // não vale nada. Espelha o JOIN dentro de current_impersonation().
    state.adminRow = null;
    state.sessionRow = SESSION;
    const { getActiveImpersonation } = await load();
    expect(await getActiveImpersonation(ACTOR)).toBeNull();
  });

  it("devolve null quando não há sessão", async () => {
    state.adminRow = { user_id: ACTOR };
    const { getActiveImpersonation } = await load();
    expect(await getActiveImpersonation(ACTOR)).toBeNull();
  });

  it("devolve null quando a consulta falha", async () => {
    state.adminRow = { user_id: ACTOR };
    state.sessionError = { message: "relation does not exist" };
    const { getActiveImpersonation } = await load();
    expect(await getActiveImpersonation(ACTOR)).toBeNull();
  });

  it("devolve null — sem lançar — se o cliente não inicializa", async () => {
    // Roda em TODA requisição autenticada, via getCurrentAccount. Se
    // lançasse, uma env faltando derrubaria o app inteiro em vez de
    // apenas desligar a impersonation.
    state.throwOnClient = true;
    const { getActiveImpersonation } = await load();
    await expect(getActiveImpersonation(ACTOR)).resolves.toBeNull();
  });
});
