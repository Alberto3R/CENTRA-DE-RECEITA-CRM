// POST /api/ai/raio-x — lê os deals da conta por vendedor, calcula a matriz
// atividade × eficiência em código e a IA prescreve o coaching. Lê o CRM vivo.

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { calcularMatriz } from "@/lib/ai/raio-x/matriz";
import { interpretarRaioX } from "@/lib/ai/raio-x";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

export async function POST() {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "raio-x");

    const linhas = await store.agregarRaioX(ctx.accountId);
    if (linhas.length === 0) {
      return NextResponse.json(
        {
          error:
            "Sem vendedores com deals atribuídos para o raio-x. Atribua deals a membros do time (campo 'responsável') primeiro.",
        },
        { status: 422 },
      );
    }

    const metricas = calcularMatriz(linhas);
    const resultado = await interpretarRaioX({ metricas });

    const salvo = await store.inserirAnaliseGenerica({
      accountId: ctx.accountId,
      tipo: "raio-x",
      dimensoes: { cortes: metricas.cortes, contagem: metricas.contagem, vendedores: metricas.vendedores },
      prescricoes: {
        interpretacao: resultado.interpretacao,
        prompt_versao: resultado.promptVersao,
      },
    });
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "raio_x.analise",
      uso: resultado.uso,
      custoUsd: calcularCustoUsd(
        resultado.uso.modelo,
        resultado.uso.tokens_in,
        resultado.uso.tokens_out,
      ),
    });
    await consumirCreditos(ctx.accountId, "raio-x");

    return NextResponse.json({
      id: salvo.id,
      metricas,
      interpretacao: resultado.interpretacao,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
