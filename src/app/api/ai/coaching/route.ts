// POST /api/ai/coaching — monta o ciclo de coaching da semana de um vendedor a
// partir das análises de call/whatsapp acumuladas dele.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { gerarCicloCoaching } from "@/lib/ai/coaching";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  sellerId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "coaching");

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

    const analises = await store.resumirAnalisesDoSeller(ctx.accountId, body.sellerId);
    if (analises.length === 0) {
      return NextResponse.json(
        {
          error:
            "Sem análises deste vendedor. Rode análises de call/WhatsApp vinculadas a ele primeiro para gerar o coaching.",
        },
        { status: 422 },
      );
    }

    const resultado = await gerarCicloCoaching({
      vendedor: { nome: seller.nome, funcao: seller.funcao },
      analises,
    });

    const salvo = await store.inserirAnaliseGenerica({
      accountId: ctx.accountId,
      tipo: "coaching",
      dimensoes: { total_analises: analises.length, seller_id: body.sellerId },
      prescricoes: {
        ciclo: resultado.ciclo,
        prompt_versao: resultado.promptVersao,
      },
    });
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "coaching.gerar",
      uso: resultado.uso,
      custoUsd: calcularCustoUsd(
        resultado.uso.modelo,
        resultado.uso.tokens_in,
        resultado.uso.tokens_out,
      ),
    });
    await consumirCreditos(ctx.accountId, "coaching");

    return NextResponse.json({ id: salvo.id, ciclo: resultado.ciclo });
  } catch (err) {
    return toErrorResponse(err);
  }
}
