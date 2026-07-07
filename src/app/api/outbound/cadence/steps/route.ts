import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { DEFAULT_CADENCE } from "@/lib/outbound/cadence";

// GET /api/outbound/cadence/steps — passos da conta (ou a lista padrão).
export async function GET() {
  try {
    const ctx = await requireRole("agent");
    const { data } = await ctx.supabase
      .from("cadence_steps")
      .select("dia,canal,position")
      .eq("account_id", ctx.accountId)
      .order("position", { ascending: true });

    const steps =
      data && data.length
        ? (data as { dia: number; canal: string }[]).map((s) => ({
            dia: s.dia,
            canal: s.canal,
          }))
        : DEFAULT_CADENCE;
    return NextResponse.json({ steps, isDefault: !(data && data.length) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PUT /api/outbound/cadence/steps — substitui a cadência inteira (admin+).
// Body: { steps: [{ dia:number, canal:string }, ...] } (na ordem desejada).
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => null)) as {
      steps?: { dia?: unknown; canal?: unknown }[];
    } | null;
    if (!body || !Array.isArray(body.steps)) {
      return NextResponse.json({ error: "payload inválido" }, { status: 400 });
    }

    const rows = body.steps
      .map((s, i) => ({
        account_id: ctx.accountId,
        position: i,
        dia: Math.max(0, Math.round(Number(s.dia))),
        canal: String(s.canal ?? "").trim(),
      }))
      .filter((r) => r.canal && Number.isFinite(r.dia));

    if (rows.length > 30) {
      return NextResponse.json(
        { error: "máximo de 30 passos" },
        { status: 400 },
      );
    }

    // Replace-all: limpa a cadência atual e regrava na ordem enviada.
    const { error: delErr } = await ctx.supabase
      .from("cadence_steps")
      .delete()
      .eq("account_id", ctx.accountId);
    if (delErr) {
      return NextResponse.json({ error: "falha ao salvar" }, { status: 500 });
    }
    if (rows.length) {
      const { error: insErr } = await ctx.supabase
        .from("cadence_steps")
        .insert(rows);
      if (insErr) {
        return NextResponse.json({ error: "falha ao salvar" }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
