// POST /api/ai/pauta-funil — lê os deals abertos do CRM, calcula o forecast em
// código e a IA monta a PAUTA da reunião de pipeline. Lê o CRM vivo.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { calcularForecast } from "@/lib/ai/pauta-funil/forecast";
import { interpretarPauta } from "@/lib/ai/pauta-funil";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  meta: z.number().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "pauta-funil");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json().catch(() => ({})));
    } catch {
      return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    }

    const deals = await store.agregarFunil(ctx.accountId, body.pipelineId);
    if (deals.length === 0) {
      return NextResponse.json(
        { error: "Nenhum deal aberto no funil para analisar." },
        { status: 422 },
      );
    }

    const calculo = calcularForecast(deals, body.meta ?? null);
    const resultado = await interpretarPauta({ calculo });

    const salvo = await store.inserirAnaliseGenerica({
      accountId: ctx.accountId,
      tipo: "pauta-funil",
      dimensoes: { resumo: calculo.resumo, gargalos: calculo.gargalos },
      prescricoes: {
        interpretacao: resultado.interpretacao,
        prompt_versao: resultado.promptVersao,
      },
    });
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "pauta_funil.analise",
      uso: resultado.uso,
      custoUsd: calcularCustoUsd(
        resultado.uso.modelo,
        resultado.uso.tokens_in,
        resultado.uso.tokens_out,
      ),
    });
    await consumirCreditos(ctx.accountId, "pauta-funil");

    return NextResponse.json({
      id: salvo.id,
      resumo: calculo.resumo,
      gargalos: calculo.gargalos,
      interpretacao: resultado.interpretacao,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
