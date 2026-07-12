// POST /api/whatsapp/broadcast/process
//
// Dreno server-side de disparos. Chamado a cada minuto pelo pg_cron (migration
// 055) com o header x-cron-secret. O segredo mora em app_config (banco) e é
// lido aqui via service role — não depende de env var na Vercel.
//
// Processa: agendados vencidos + disparos 'sending' que ficaram ociosos (aba
// fechada no meio). Idempotente e com claim atômico (anti-duplo-envio).

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { processDueBroadcasts } from "@/lib/broadcast/worker";

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

    const result = await processDueBroadcasts();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[broadcast/process] erro:", err);
    return NextResponse.json({ error: "Falha ao processar disparos" }, { status: 500 });
  }
}
