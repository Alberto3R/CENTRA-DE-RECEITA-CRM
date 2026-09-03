// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { getActiveImpersonation } from "./platform-admin";

// ------------------------------------------------------------
// Errors
//
// Definidos em `./errors` para evitar ciclo de import com
// `./platform-admin`. Re-exportados aqui porque todo o app importa
// `toErrorResponse` / `ForbiddenError` deste módulo.
// ------------------------------------------------------------

export { ForbiddenError, UnauthorizedError, toErrorResponse } from "./errors";

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name. */
  account: { id: string; name: string };
  /**
   * Suspensão de acesso (migrações 094/095). `suspendsAt` é o prazo
   * anunciado no aviso; `suspended` diz se ele já venceu.
   *
   * O corte de verdade é o RLS — `is_account_member()` nega tudo depois
   * do prazo. Isto aqui existe para o app conseguir MOSTRAR a tela certa
   * em vez de uma sequência de listas vazias.
   */
  suspension: {
    suspended: boolean;
    suspendsAt: string | null;
    reason: string | null;
  };
  /**
   * Preenchido quando o chamador é um platform admin com sessão de
   * impersonation ativa. Nesse caso `accountId`/`account` apontam para o
   * tenant impersonado e `role` é sempre `viewer`.
   *
   * `userId` continua sendo o do admin de verdade — nunca o de alguém do
   * tenant. Trocar a identidade quebraria o rastro de quem fez o quê, que
   * é justamente o que o log de impersonation existe para preservar.
   */
  impersonation?: {
    sessionId: string;
    /** Conta à qual o admin realmente pertence. */
    actorAccountId: string;
    expiresAt: string;
    reason: string;
  };
}

/**
 * Prazo de suspensão vencido?
 *
 * Separado da consulta para poder ser testado nas bordas: sem prazo,
 * prazo no futuro (ainda é só aviso), prazo vencido, e impersonation —
 * que nunca é bloqueada, porque é como a Sales 3R entra na conta
 * suspensa para inspecionar e resolver.
 */
export function prazoVencido(
  suspendsAt: string | null | undefined,
  opts: { impersonando?: boolean; agora?: number } = {},
): boolean {
  if (opts.impersonando) return false;
  if (!suspendsAt) return false;
  const prazo = new Date(suspendsAt).getTime();
  if (!Number.isFinite(prazo)) return false;
  return prazo <= (opts.agora ?? Date.now());
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }
  if (!data || !data.account_id || !data.account_role) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(data.account_role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  // Impersonation: um platform admin com sessão ativa passa a operar
  // SOBRE o tenant alvo. Só o alvo da resolução muda — `userId` segue
  // sendo o do admin, e o papel é rebaixado a `viewer`.
  //
  // O rebaixamento é a segunda camada de defesa: `requireRole('agent')`
  // e acima passam a lançar Forbidden, então rotas de escrita são
  // recusadas antes de tocar o banco. A primeira camada continua sendo
  // a policy da migration 084, que nega a escrita mesmo que esta aqui
  // seja contornada.
  const impersonation = await getActiveImpersonation(user.id);
  const effectiveAccountId = impersonation?.targetAccountId ?? data.account_id;
  const effectiveRole: AccountRole = impersonation ? "viewer" : data.account_role;

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the profiles.account_id → accounts.id
  // relationship from its schema cache; when that cache is stale — a
  // common Supabase state right after a migration adds the FK, or when
  // migrations are applied out of band — the embed fails hard with
  // PGRST200 ("could not find a relationship … in the schema cache")
  // and takes down the entire account context (issue #294). A lookup by
  // id needs no relationship inference and is gated by the same accounts
  // RLS, so it stays robust against cache staleness and older schemas.
  type ContaLida = {
    id: string;
    name: string;
    access_suspends_at?: string | null;
    suspension_reason?: string | null;
  };

  let { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id, name, access_suspends_at, suspension_reason")
    .eq("id", effectiveAccountId)
    .maybeSingle<ContaLida>();

  // Banco sem as colunas da migração 094 (ambiente atrasado, código no ar
  // antes da migração): relê só o essencial. Este contexto sustenta o app
  // INTEIRO — deixar o app cair por causa de uma coluna de aviso trocaria
  // um recurso novo por um apagão geral.
  if (accountErr) {
    const retry = await supabase
      .from("accounts")
      .select("id, name")
      .eq("id", effectiveAccountId)
      .maybeSingle<ContaLida>();
    if (!retry.error) {
      account = retry.data;
      accountErr = null;
    }
  }

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!account) {
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError("Profile is not linked to an account");
  }

  const suspendsAt = account.access_suspends_at ?? null;

  return {
    supabase,
    userId: user.id,
    accountId: effectiveAccountId,
    role: effectiveRole,
    account: { id: account.id, name: account.name },
    suspension: {
      suspended: prazoVencido(suspendsAt, {
        impersonando: !!impersonation,
      }),
      suspendsAt,
      reason: account.suspension_reason ?? null,
    },
    ...(impersonation
      ? {
          impersonation: {
            sessionId: impersonation.id,
            actorAccountId: data.account_id,
            expiresAt: impersonation.expiresAt,
            reason: impersonation.reason,
          },
        }
      : {}),
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}
