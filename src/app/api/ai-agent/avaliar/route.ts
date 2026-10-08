import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { avaliarConversa } from "@/lib/ai-agent/avaliar";

// ============================================================
// POST /api/ai-agent/avaliar
//
// Revisão automática do agente de atendimento — chamada pelo pg_cron a cada
// 15 min (migration 110). Pega as conversas em que o agente rodou e que
// ainda não foram lidas (ou em que ele seguiu conversando), avalia o trecho
// do agente e grava em ai_agente_avaliacoes, que alimenta a página
// "Resultado do agente". Auth: x-cron-secret == app_config
// ('agente_avaliacao_cron_secret').
// ============================================================

export const maxDuration = 300;

const LOTE = 20;
const EM_PARALELO = 4;

export async function POST(request: Request) {
  const db = supabaseAdmin();
  const { data: secretRow } = await db
    .from("app_config")
    .select("value")
    .eq("key", "agente_avaliacao_cron_secret")
    .maybeSingle();
  const secret = (secretRow as { value?: string } | null)?.value;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: fila, error } = await db.rpc("agente_conversas_para_avaliar", {
    p_limite: LOTE,
  });
  if (error) {
    console.error("[agente-avaliacao] fila falhou:", error.message);
    return NextResponse.json({ ok: false, error: "fila_falhou" }, { status: 500 });
  }

  const itens = (fila ?? []) as {
    conversation_id: string;
    account_id: string;
    agent_id: string | null;
  }[];
  const contagem: Record<string, number> = {};
  for (let i = 0; i < itens.length; i += EM_PARALELO) {
    const resultados = await Promise.all(
      itens.slice(i, i + EM_PARALELO).map((it) =>
        avaliarConversa(db, {
          conversationId: it.conversation_id,
          accountId: it.account_id,
          agentId: it.agent_id,
        }).catch((e) => {
          console.error("[agente-avaliacao] conversa", it.conversation_id, e);
          return "falhou" as const;
        }),
      ),
    );
    for (const r of resultados) contagem[r] = (contagem[r] ?? 0) + 1;
  }
  return NextResponse.json({ ok: true, fila: itens.length, ...contagem });
}
