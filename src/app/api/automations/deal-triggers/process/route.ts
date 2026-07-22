import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processDealStageTriggers } from "@/lib/flows/deal-trigger";

// ============================================================
// POST /api/automations/deal-triggers/process
//
// Sweeper do gatilho "negócio entra em etapa" (flows.trigger_type =
// 'deal_stage'). Chamado pelo pg_cron a cada minuto (migration 079).
// Cobre TODAS as origens de mudança de etapa (webhook de leads, arraste
// no kanban, import, API) porque lê deal_stage_events — o trigger do
// banco registra tudo. Auth: x-cron-secret == app_config
// ('flows_deal_cron_secret'). Idempotente via flow_deal_trigger_log.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null;
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

export async function POST(request: Request) {
  const db = admin();
  const { data: secretRow } = await db
    .from("app_config")
    .select("value")
    .eq("key", "flows_deal_cron_secret")
    .maybeSingle();
  const secret = (secretRow as { value?: string } | null)?.value;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDealStageTriggers(db);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[deal-triggers] sweep falhou:", err);
    return NextResponse.json({ ok: false, error: "sweep_failed" }, { status: 500 });
  }
}
