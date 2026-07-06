// POST /api/ai/campanhas — gera uma campanha (gamificação ou oferta).
// Padrão: requireRole('agent') → assertQuota('geracao') → engine → store → consumir.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { carregarSalesConfig } from "@/lib/ai/config";
import { gerarCampanha } from "@/lib/ai/campanhas";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  tipo: z.enum(["gamificacao", "oferta"]),
  contexto: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "campanhas");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { error: "Corpo inválido: informe `tipo` (gamificacao|oferta)." },
        { status: 400 },
      );
    }

    const config = await carregarSalesConfig(ctx.supabase, ctx.accountId);
    const resultado = await gerarCampanha({
      tipo: body.tipo,
      contexto: body.contexto,
      contextoComercial: {
        icp: config.icp,
        produto: config.produto,
        oferta: config.oferta,
        nicho: null,
        identidade: config.tomDeVoz,
      },
    });

    const salvo = await store.inserirCampanha({
      accountId: ctx.accountId,
      tipo: resultado.campanha.tipo,
      titulo: resultado.campanha.titulo,
      mecanica: resultado.campanha.mecanica,
      copy: resultado.materiaisMd,
    });
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "campanhas.gerar",
      uso: resultado.uso,
      custoUsd: calcularCustoUsd(
        resultado.uso.modelo,
        resultado.uso.tokens_in,
        resultado.uso.tokens_out,
      ),
    });
    await consumirCreditos(ctx.accountId, "campanhas");

    return NextResponse.json({
      id: salvo.id,
      campanha: resultado.campanha,
      materiaisMd: resultado.materiaisMd,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
