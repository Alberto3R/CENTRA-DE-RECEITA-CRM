// POST /api/ai/pdi — gera o parecer + PDI de 90 dias (RASCUNHO) de um vendedor.
// A assinatura do gestor é um passo humano posterior (status 'rascunho').

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { gerarPDI } from "@/lib/ai/pdi";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  sellerId: z.string().uuid(),
  observacoes: z.string().max(4000).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "pdi");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { error: "Corpo inválido: informe `sellerId`." },
        { status: 400 },
      );
    }

    const seller = await store.buscarSeller(ctx.accountId, body.sellerId);
    if (!seller) {
      return NextResponse.json(
        { error: "Vendedor não encontrado nesta conta." },
        { status: 404 },
      );
    }

    const resultado = await gerarPDI({
      vendedor: { nome: seller.nome, funcao: seller.funcao },
      observacoes: body.observacoes,
    });

    const salvo = await store.inserirPdi({
      accountId: ctx.accountId,
      sellerId: body.sellerId,
      parecerTexto: resultado.pdi.parecer.leitura,
      plano: {
        parecer: resultado.pdi.parecer,
        plano_90d: resultado.pdi.plano_90d,
        recomendacao: resultado.pdi.recomendacao,
        prompt_versao: resultado.promptVersao,
      },
    });
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "pdi.gerar",
      uso: resultado.uso,
      custoUsd: calcularCustoUsd(
        resultado.uso.modelo,
        resultado.uso.tokens_in,
        resultado.uso.tokens_out,
      ),
    });
    await consumirCreditos(ctx.accountId, "pdi");

    return NextResponse.json({ id: salvo.id, pdi: resultado.pdi });
  } catch (err) {
    return toErrorResponse(err);
  }
}
