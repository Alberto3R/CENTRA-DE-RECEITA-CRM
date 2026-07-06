// POST /api/ai/scripts — gera um script comercial (9 etapas) com o contexto da conta.
// Padrão: requireRole('agent') → assertQuota('geracao') → engine → store → consumir.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { carregarSalesConfig } from "@/lib/ai/config";
import { gerarScriptComercial } from "@/lib/ai/script-comercial";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  contexto: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "scripts");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json().catch(() => ({})));
    } catch {
      return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    }

    const config = await carregarSalesConfig(ctx.supabase, ctx.accountId);
    const resultado = await gerarScriptComercial({
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
      tipo: "comercial",
      titulo: resultado.script.titulo,
      etapas: resultado.script.etapas,
      versoes: [{ prompt_versao: resultado.promptVersao, conteudo_md: resultado.conteudoMd }],
    });
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "scripts.gerar",
      uso: resultado.uso,
      custoUsd: calcularCustoUsd(
        resultado.uso.modelo,
        resultado.uso.tokens_in,
        resultado.uso.tokens_out,
      ),
    });
    await consumirCreditos(ctx.accountId, "scripts");

    return NextResponse.json({
      id: salvo.id,
      script: resultado.script,
      conteudoMd: resultado.conteudoMd,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
