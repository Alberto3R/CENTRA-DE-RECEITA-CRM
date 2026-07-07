import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

const DEFAULTS = {
  dials: 50,
  atendimentos: 12,
  decisor: 6,
  whatsapp: 30,
  reunioes: 1,
  qualificados: 4,
  reunioes_mes: 22,
};
const CAMPOS = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];

// GET /api/outbound/targets — metas da conta (ou defaults).
export async function GET() {
  try {
    const ctx = await requireRole("agent");
    const { data } = await ctx.supabase
      .from("outbound_targets")
      .select("*")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    const metas = { ...DEFAULTS };
    if (data) for (const k of CAMPOS) metas[k] = (data as Record<string, number>)[k];
    return NextResponse.json({ metas });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/outbound/targets — salva as metas (admin+).
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "payload inválido" }, { status: 400 });

    const row: Record<string, number | string> = { account_id: ctx.accountId };
    for (const k of CAMPOS) {
      const v = Math.max(0, Math.round(Number(body[k])));
      row[k] = Number.isFinite(v) ? v : DEFAULTS[k];
    }
    row.updated_at = new Date().toISOString();

    const { error } = await ctx.supabase
      .from("outbound_targets")
      .upsert(row, { onConflict: "account_id" });
    if (error) return NextResponse.json({ error: "falha ao salvar" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
