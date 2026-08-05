// ============================================================
// Erros de autorização — classes tipadas + tradução para HTTP.
//
// Vivem num módulo próprio (e não em `account.ts`, onde nasceram)
// porque `platform-admin.ts` precisa delas e `account.ts` precisa de
// `platform-admin.ts`. Sem esta separação, os dois se importariam em
// ciclo. `account.ts` re-exporta tudo daqui, então os call sites que
// importam de `@/lib/auth/account` continuam valendo.
// ============================================================

import { NextResponse } from "next/server";

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
