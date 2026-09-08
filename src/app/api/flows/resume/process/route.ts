// POST /api/flows/resume/process
//
// Acorda os runs de fluxo que estão esperando TEMPO (nó `wait`). Chamado de
// minuto em minuto pelo pg_cron com o header x-cron-secret — o mesmo segredo
// do dreno de disparos, que mora em app_config e não depende de env var.
//
// É este worker que separa "fluxo conversacional" de "cadência": sem ele um
// nó de espera para o run e ninguém volta para buscá-lo.

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { processDueFlowWaits } from "@/lib/flows/engine";

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

    const result = await processDueFlowWaits();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[flows/resume] erro:", err);
    return NextResponse.json({ error: "Falha ao retomar fluxos" }, { status: 500 });
  }
}
