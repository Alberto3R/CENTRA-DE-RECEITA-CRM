// POST /api/whatsapp/scheduled/process
//
// Dreno das mensagens agendadas 1:1. Chamado a cada minuto pelo pg_cron
// (migration 087) com o header x-cron-secret. O segredo mora em
// app_config (banco) e é lido aqui via service role — sem env nova,
// mesmo esquema do dreno de disparos (055).

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { processDueScheduledMessages } from "@/lib/scheduled-messages/worker";

export const maxDuration = 60;

/** Comparação de tempo constante — evita vazar o segredo por timing. */
function secretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
      .eq("key", "scheduled_messages_cron_secret")
      .maybeSingle();

    const expected = (cfg as { value?: string } | null)?.value;
    if (!expected) {
      return NextResponse.json(
        { error: "worker not configured" },
        { status: 503 },
      );
    }
    if (!secretMatches(supplied, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await processDueScheduledMessages();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[scheduled/process] erro:", err);
    return NextResponse.json(
      { error: "Falha ao processar mensagens agendadas" },
      { status: 500 },
    );
  }
}
