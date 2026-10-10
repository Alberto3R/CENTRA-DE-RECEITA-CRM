// POST /api/ajuda/chat — responde dúvidas de uso do CRM com base na Central de
// Ajuda. Aberto a todos os papéis (inclusive Visualizador) e não consome
// créditos do Gestor Comercial; a trava é de volume por usuário.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";
import { responderDuvida } from "@/lib/ajuda/responder";

const LIMITE_POR_HORA = 40;

const bodySchema = z.object({
  mensagens: z
    .array(
      z.object({
        papel: z.enum(["usuario", "ajuda"]),
        texto: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("viewer");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
    }
    const ultima = body.mensagens.at(-1);
    if (!ultima || ultima.papel !== "usuario") {
      return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
    }

    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await ctx.supabase
      .from("ajuda_chat_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId)
      .gte("created_at", umaHoraAtras);
    if ((count ?? 0) >= LIMITE_POR_HORA) {
      return NextResponse.json(
        {
          error:
            "Você chegou ao limite de perguntas desta hora. Tente de novo mais tarde ou fale com o suporte.",
        },
        { status: 429 },
      );
    }

    let r: Awaited<ReturnType<typeof responderDuvida>>;
    try {
      r = await responderDuvida(body.mensagens);
    } catch (err) {
      console.error("[ajuda/chat] falha ao responder", err);
      return NextResponse.json(
        {
          error:
            "Não consegui responder agora. Procure na Central de Ajuda ou fale com o suporte.",
        },
        { status: 503 },
      );
    }

    const { error: logErr } = await ctx.supabase.from("ajuda_chat_logs").insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      pergunta: ultima.texto,
      resposta: r.resposta,
      artigos: r.artigos.map((a) => a.slug),
      encontrou: r.encontrou,
    });
    if (logErr) console.error(`[ajuda/chat] falha ao registrar: ${logErr.message}`);
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "ajuda.chat",
      uso: r.uso,
      custoUsd: calcularCustoUsd(r.uso.modelo, r.uso.tokens_in, r.uso.tokens_out),
    });

    return NextResponse.json({
      resposta: r.resposta,
      artigos: r.artigos,
      encontrou: r.encontrou,
    });
  } catch (err) {
    console.error("[ajuda/chat]", err);
    return toErrorResponse(err);
  }
}
