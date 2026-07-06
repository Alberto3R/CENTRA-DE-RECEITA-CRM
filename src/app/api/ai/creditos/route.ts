// GET /api/ai/creditos — saldo de créditos do Gestor no mês (para o chip da UI).

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { saldoCreditos } from "@/lib/billing/quota";

export async function GET() {
  try {
    const ctx = await requireRole("agent");
    const saldo = await saldoCreditos(ctx.accountId);
    return NextResponse.json({
      plano: saldo.plano,
      total: saldo.total,
      usados: saldo.usados,
      // -1 sinaliza ilimitado (Infinity não sobrevive ao JSON).
      restantes: saldo.total < 0 ? -1 : saldo.restantes,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
