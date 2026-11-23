// POST /api/google/booking-sync/process
//
// Leitura das reservas feitas na página de agendamento do Google (agenda
// conectada da conta). Chamado a cada 5 min pelo pg_cron (migration 125)
// com o header x-cron-secret; o segredo mora em app_config
// ('booking_sync_cron_secret'), mesmo esquema dos outros drenos.
// /api/google/* não passa pelo bloqueio de API do middleware, então a
// autenticação é só esta.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { processBookingSync } from "@/lib/google/booking-sync";

export const maxDuration = 60;

function secretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  try {
    const supplied = request.headers.get("x-cron-secret");
    if (!supplied) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: cfg } = await supabaseAdmin()
      .from("app_config")
      .select("value")
      .eq("key", "booking_sync_cron_secret")
      .maybeSingle();
    const expected = (cfg as { value?: string } | null)?.value;
    if (!expected) return NextResponse.json({ error: "worker not configured" }, { status: 503 });
    if (!secretMatches(supplied, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await processBookingSync();
    if (result.errors.length) console.error("[booking-sync] erros:", result.errors);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[booking-sync] erro:", err);
    return NextResponse.json({ error: "Falha ao ler as reservas" }, { status: 500 });
  }
}
