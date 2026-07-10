// GET /api/ai/analise-call/[id] — reabre uma análise salva (completa) da conta.
// Usado pelo histórico da página de Análise de conversa.

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import * as store from "@/lib/ai/store";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: "Análise não encontrada." },
        { status: 404 },
      );
    }
    const ctx = await requireRole("viewer");
    const detalhe = await store.buscarAnalisePorId(ctx.accountId, id);
    if (!detalhe) {
      return NextResponse.json(
        { error: "Análise não encontrada." },
        { status: 404 },
      );
    }
    return NextResponse.json(detalhe);
  } catch (err) {
    return toErrorResponse(err);
  }
}
