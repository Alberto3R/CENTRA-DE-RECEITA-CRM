import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

// Cadência outbound padrão (SpectraX-style). dia = offset em dias desde a
// inscrição. O ENVIO real fica nas Automações; aqui é só a fila de adesão.
const CADENCE = [
  { dia: 0, canal: "Ligação" },
  { dia: 1, canal: "WhatsApp" },
  { dia: 2, canal: "Ligação" },
  { dia: 4, canal: "E-mail" },
  { dia: 6, canal: "Ligação" },
  { dia: 8, canal: "WhatsApp (última tentativa)" },
];

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/outbound/cadence — leads com toque vencido/hoje (fila do dia).
export async function GET() {
  try {
    const ctx = await requireRole("agent");
    const { data } = await ctx.supabase
      .from("cadence_enrollments")
      .select(
        "id,passo,proximo_em,deal:deals(title,contact:contacts(name,phone))",
      )
      .eq("account_id", ctx.accountId)
      .eq("status", "active")
      .lte("proximo_em", hoje())
      .order("proximo_em", { ascending: true })
      .limit(60);

    const items = ((data as unknown[]) ?? []).map((r) => {
      const row = r as {
        id: string;
        passo: number;
        proximo_em: string;
        deal: { title?: string; contact?: { name?: string; phone?: string } } | null;
      };
      const step = CADENCE[row.passo];
      return {
        id: row.id,
        passo: row.passo,
        canal: step?.canal ?? "—",
        total: CADENCE.length,
        proximo_em: row.proximo_em,
        atrasado: row.proximo_em < hoje(),
        titulo: row.deal?.title ?? "Lead",
        contato: row.deal?.contact?.name ?? row.deal?.contact?.phone ?? "—",
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/outbound/cadence — avança o passo de uma inscrição (toque feito).
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) {
      return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });
    }

    const { data: enr } = await ctx.supabase
      .from("cadence_enrollments")
      .select("id,passo,enrolled_at")
      .eq("account_id", ctx.accountId)
      .eq("id", body.id)
      .maybeSingle<{ id: string; passo: number; enrolled_at: string }>();
    if (!enr) {
      return NextResponse.json({ error: "inscrição não encontrada" }, { status: 404 });
    }

    const novoPasso = enr.passo + 1;
    let patch: Record<string, unknown>;
    if (novoPasso >= CADENCE.length) {
      patch = { passo: novoPasso, status: "done", updated_at: new Date().toISOString() };
    } else {
      const base = new Date(enr.enrolled_at);
      base.setDate(base.getDate() + CADENCE[novoPasso].dia);
      patch = {
        passo: novoPasso,
        proximo_em: base.toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      };
    }

    const { error } = await ctx.supabase
      .from("cadence_enrollments")
      .update(patch)
      .eq("id", enr.id);
    if (error) {
      return NextResponse.json({ error: "falha ao avançar" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, done: novoPasso >= CADENCE.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
