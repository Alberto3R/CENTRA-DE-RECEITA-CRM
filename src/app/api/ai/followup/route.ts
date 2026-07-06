// POST /api/ai/followup — gera cadência de retomada + kit anti no-show.
// Padrão: requireRole('agent') → assertQuota('geracao') → engine → store → consumir.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { carregarSalesConfig } from "@/lib/ai/config";
import { gerarFollowup } from "@/lib/ai/followup";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  contexto: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "followup");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json().catch(() => ({})));
    } catch {
      return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    }

    const config = await carregarSalesConfig(ctx.supabase, ctx.accountId);
    const resultado = await gerarFollowup({
      contexto: body.contexto,
      contextoComercial: {
        icp: config.icp,
        produto: config.produto,
        oferta: config.oferta,
        nicho: null,
        identidade: config.tomDeVoz,
      },
    });

    const salvo = await store.inserirScript({
      accountId: ctx.accountId,
      tipo: "followup",
      titulo: resultado.resultado.titulo,
      etapas: {
        cadencia: resultado.resultado.cadencia_followup,
        comparecimento: resultado.resultado.kit_comparecimento,
      },
      versoes: [
        {
          prompt_versao: resultado.promptVersao,
          cadencia_md: resultado.cadenciaMd,
          comparecimento_md: resultado.comparecimentoMd,
        },
      ],
    });
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "followup.gerar",
      uso: resultado.uso,
      custoUsd: calcularCustoUsd(
        resultado.uso.modelo,
        resultado.uso.tokens_in,
        resultado.uso.tokens_out,
      ),
    });
    await consumirCreditos(ctx.accountId, "followup");

    return NextResponse.json({
      id: salvo.id,
      resultado: resultado.resultado,
      cadenciaMd: resultado.cadenciaMd,
      comparecimentoMd: resultado.comparecimentoMd,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
