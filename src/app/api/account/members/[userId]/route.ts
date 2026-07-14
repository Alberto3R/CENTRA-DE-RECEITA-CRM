// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// Both delegate to SECURITY DEFINER RPCs from migration 018:
//   - set_member_role(p_user_id, p_new_role)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account, target can't be the
// owner, can't be self. The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const FUNCOES_COMERCIAIS = ["closer", "sdr", "social_seller", "gestor"];

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; funcao?: unknown }
      | null;

    const temRole = body != null && "role" in body;
    const temFuncao = body != null && "funcao" in body;
    if (!temRole && !temFuncao) {
      return NextResponse.json(
        { error: "Informe 'role' e/ou 'funcao'." },
        { status: 400 },
      );
    }

    // Nível de acesso (RBAC) — via RPC SECURITY DEFINER.
    if (temRole) {
      const role = body?.role;
      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }
      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }
      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role,
      });
      if (error) return rpcErrorToResponse(error);
    }

    // Função comercial (define a régua de análise). null limpa. Atualiza via
    // service client, mas só após confirmar que o alvo é desta conta.
    if (temFuncao) {
      const funcao = body?.funcao;
      if (funcao !== null && !FUNCOES_COMERCIAIS.includes(funcao as string)) {
        return NextResponse.json(
          { error: "'funcao' inválida (closer, sdr, social_seller, gestor)." },
          { status: 400 },
        );
      }
      const admin = supabaseAdmin();
      const { data: alvo } = await admin
        .from("profiles")
        .select("account_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!alvo || alvo.account_id !== ctx.accountId) {
        return NextResponse.json(
          { error: "Membro não pertence a esta conta." },
          { status: 400 },
        );
      }
      const { error: fErr } = await admin
        .from("profiles")
        .update({ funcao: funcao as string | null })
        .eq("user_id", userId)
        .eq("account_id", ctx.accountId);
      if (fErr) {
        console.error("[members PATCH] funcao update error:", fErr);
        return NextResponse.json(
          { error: "Falha ao atualizar a função." },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    // Remove do CRM (apaga o profile — corta o acesso a dados na hora; sem
    // conta pessoal nova).
    const { error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    // Suspende o login (banido) — regra do negócio: quem é removido não acessa
    // mais nada. Best-effort: a remoção do profile já cortou o acesso a dados.
    try {
      await supabaseAdmin().auth.admin.updateUserById(userId, {
        ban_duration: "876600h", // ~100 anos (reversível: ban_duration: 'none')
      });
    } catch (banErr) {
      console.error("[members DELETE] falha ao suspender login:", banErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
