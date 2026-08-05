import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/errors";
import {
  IMPERSONATION_TTL_MINUTES,
  MIN_REASON_LENGTH,
  endImpersonation,
  getActiveImpersonation,
  requirePlatformAdmin,
  startImpersonation,
} from "@/lib/auth/platform-admin";
import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * Sessão de impersonation — abrir, consultar e encerrar.
 *
 * Não existe cookie nem token aqui: o estado da sessão é a linha em
 * `impersonation_sessions`. Quem concede o acesso é o Postgres, lendo
 * essa linha de dentro da policy. Estas rotas só criam e encerram a
 * linha — não carregam autoridade nenhuma por si.
 *
 * Consequência prática: mesmo que um atacante conseguisse chamar POST,
 * sem estar em `platform_admins` a linha criada seria inerte, porque
 * `current_impersonation()` faz join com essa tabela.
 */

/** GET — a sessão ativa do chamador, para o banner e o painel. */
export async function GET() {
  try {
    const { userId } = await requirePlatformAdmin();
    const session = await getActiveImpersonation(userId);
    if (!session) return NextResponse.json({ active: null });

    const { data: account } = await supabaseAdmin()
      .from("accounts")
      .select("id, name")
      .eq("id", session.targetAccountId)
      .maybeSingle();

    return NextResponse.json({
      active: {
        sessionId: session.id,
        accountId: session.targetAccountId,
        accountName: account?.name ?? "Conta desconhecida",
        reason: session.reason,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST — abre a sessão. Body: { accountId, reason }. */
export async function POST(request: Request) {
  try {
    const { userId } = await requirePlatformAdmin();

    const body = (await request.json().catch(() => null)) as {
      accountId?: string;
      reason?: string;
    } | null;

    const accountId = body?.accountId?.trim();
    const reason = body?.reason?.trim() ?? "";

    if (!accountId) {
      return NextResponse.json(
        { error: "accountId é obrigatório." },
        { status: 400 },
      );
    }
    if (reason.length < MIN_REASON_LENGTH) {
      // O mesmo mínimo existe como CHECK no banco. Validar aqui é só
      // para devolver uma mensagem legível em vez de erro de constraint.
      return NextResponse.json(
        {
          error: `Descreva o motivo com pelo menos ${MIN_REASON_LENGTH} caracteres — ele fica no log permanente.`,
        },
        { status: 400 },
      );
    }

    // Confirma que a conta existe antes de gravar. Sem isto o FK
    // devolveria um 500 opaco para um simples id errado.
    const { data: account } = await supabaseAdmin()
      .from("accounts")
      .select("id, name")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) {
      return NextResponse.json(
        { error: "Conta não encontrada." },
        { status: 404 },
      );
    }

    const session = await startImpersonation({
      actorUserId: userId,
      targetAccountId: accountId,
      reason,
    });

    console.warn(
      `[impersonation] INÍCIO actor=${userId} tenant=${accountId} sessao=${session.id} motivo="${reason}"`,
    );

    return NextResponse.json({
      active: {
        sessionId: session.id,
        accountId: account.id,
        accountName: account.name,
        reason: session.reason,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
      },
      ttlMinutes: IMPERSONATION_TTL_MINUTES,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE — encerra a sessão ativa. Idempotente. */
export async function DELETE() {
  try {
    const { userId } = await requirePlatformAdmin();
    await endImpersonation({ actorUserId: userId });
    console.warn(`[impersonation] FIM actor=${userId}`);
    return NextResponse.json({ active: null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
