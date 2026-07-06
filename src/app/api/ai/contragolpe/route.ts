// POST /api/ai/contragolpe — gera 2–3 contornos para uma objeção real.
// Padrão: requireRole('agent') → assertQuota('geracao') → engine → store → consumir.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { carregarSalesConfig } from "@/lib/ai/config";
import { gerarContragolpe } from "@/lib/ai/contragolpe";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  objecao: z.string().min(1).max(4000),
  contexto: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "contragolpe");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { error: "Corpo inválido: informe `objecao`." },
        { status: 400 },
      );
    }

    const config = await carregarSalesConfig(ctx.supabase, ctx.accountId);
    const resultado = await gerarContragolpe({
      objecao: body.objecao,
      contexto: body.contexto,
      tom: config.tomDeVoz,
    });

    const salvo = await store.inserirObjecao({
      accountId: ctx.accountId,
      origem: "texto",
      objecao: resultado.contragolpe.objecao_resumida,
      contornos: resultado.contragolpe,
    });
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "contragolpe.gerar",
      uso: resultado.uso,
      custoUsd: calcularCustoUsd(
        resultado.uso.modelo,
        resultado.uso.tokens_in,
        resultado.uso.tokens_out,
      ),
    });
    await consumirCreditos(ctx.accountId, "contragolpe");

    return NextResponse.json({ id: salvo.id, contragolpe: resultado.contragolpe });
  } catch (err) {
    return toErrorResponse(err);
  }
}
