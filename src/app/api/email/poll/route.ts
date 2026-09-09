// POST /api/email/poll
//
// Busca as respostas nas caixas dos canais de e-mail e as põe no inbox.
// Chamado a cada 2 minutos pelo pg_cron com o header x-cron-secret — mesmo
// segredo do dreno de disparos, guardado em app_config.
//
// Existe porque IMAP IDLE não sobrevive em serverless: a conexão persistente
// morre quando a função responde. Polling é o desenho que o projeto já usa.

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { processarCaixasDeEntrada } from "@/lib/email/poll";

// IMAP abre socket TCP: precisa de runtime Node, nunca edge.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const supplied = request.headers.get("x-cron-secret");
    if (!supplied) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { data: cfg } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "broadcast_cron_secret")
      .maybeSingle();
    const expected = cfg?.value as string | undefined;
    if (!expected) {
      return NextResponse.json({ error: "worker not configured" }, { status: 503 });
    }
    if (supplied !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resultado = await processarCaixasDeEntrada();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    console.error("[email/poll] erro:", err);
    return NextResponse.json({ error: "Falha ao ler as caixas" }, { status: 500 });
  }
}
