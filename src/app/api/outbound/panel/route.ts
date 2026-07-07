import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

// Metas DIÁRIAS por SDR (defaults — vindas da operação SpectraX; viram config
// por conta numa fase futura). Reuniões e forecast usam a meta mensal.
const METAS = {
  dials: 50,
  atendimentos: 12,
  decisor: 6,
  whatsapp: 30,
  reunioes: 1,
  qualificados: 4,
} as const;
const META_REUNIOES_MES = 22;
const DIAS_UTEIS_MES = 22; // dias úteis médios no mês (base da projeção)

const TIPOS = ["call", "whatsapp", "email", "meeting", "qualification"];
const RESULTADOS = ["no_answer", "connected", "decision_maker"];

interface Row {
  user_id: string;
  tipo: string;
  resultado: string | null;
}

// GET /api/outbound/panel?from=<iso>&to=<iso>&monthFrom=<iso>&diasUteis=<n>
// Agrega as atividades do dia por SDR + totais do time + forecast do mês.
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const sp = new URL(request.url).searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const monthFrom = sp.get("monthFrom");
    const diasUteis = Math.max(1, Number(sp.get("diasUteis") || "1"));
    if (!from || !to || !monthFrom) {
      return NextResponse.json({ error: "faltam parâmetros de data" }, { status: 400 });
    }

    const sb = ctx.supabase;

    const [{ data: acts }, { data: profs }, { count: reunioesMes }, { data: tRow }] =
      await Promise.all([
        sb
          .from("sdr_activities")
          .select("user_id,tipo,resultado")
          .eq("account_id", ctx.accountId)
          .gte("created_at", from)
          .lte("created_at", to),
        sb
          .from("profiles")
          .select("user_id,full_name")
          .eq("account_id", ctx.accountId),
        sb
          .from("sdr_activities")
          .select("id", { count: "exact", head: true })
          .eq("account_id", ctx.accountId)
          .eq("tipo", "meeting")
          .gte("created_at", monthFrom),
        sb
          .from("outbound_targets")
          .select("*")
          .eq("account_id", ctx.accountId)
          .maybeSingle(),
      ]);

    const nameById = new Map<string, string>(
      ((profs as { user_id: string; full_name: string | null }[]) ?? []).map((p) => [
        p.user_id,
        p.full_name || "SDR",
      ]),
    );

    const blank = () => ({
      dials: 0,
      atendimentos: 0,
      decisor: 0,
      whatsapp: 0,
      reunioes: 0,
      qualificados: 0,
    });
    const byUser = new Map<string, ReturnType<typeof blank>>();
    for (const a of ((acts as Row[]) ?? [])) {
      const u = byUser.get(a.user_id) ?? blank();
      if (a.tipo === "call") {
        u.dials++;
        if (a.resultado === "connected" || a.resultado === "decision_maker")
          u.atendimentos++;
        if (a.resultado === "decision_maker") u.decisor++;
      } else if (a.tipo === "whatsapp") u.whatsapp++;
      else if (a.tipo === "meeting") u.reunioes++;
      else if (a.tipo === "qualification") u.qualificados++;
      byUser.set(a.user_id, u);
    }

    const sdrs = [...byUser.entries()].map(([user_id, v]) => ({
      user_id,
      name: nameById.get(user_id) ?? "SDR",
      ...v,
    }));
    const team = sdrs.reduce(
      (t, s) => ({
        dials: t.dials + s.dials,
        atendimentos: t.atendimentos + s.atendimentos,
        decisor: t.decisor + s.decisor,
        whatsapp: t.whatsapp + s.whatsapp,
        reunioes: t.reunioes + s.reunioes,
        qualificados: t.qualificados + s.qualificados,
      }),
      blank(),
    );

    const t = tRow as Record<string, number> | null;
    const metas = t
      ? {
          dials: t.dials,
          atendimentos: t.atendimentos,
          decisor: t.decisor,
          whatsapp: t.whatsapp,
          reunioes: t.reunioes,
          qualificados: t.qualificados,
        }
      : METAS;
    const metaReunioesMes = t?.reunioes_mes ?? META_REUNIOES_MES;
    const projecaoMes = Math.round(((reunioesMes ?? 0) / diasUteis) * DIAS_UTEIS_MES);

    return NextResponse.json({
      metas,
      metaReunioesMes,
      sdrs,
      team,
      forecast: { reunioesMes: reunioesMes ?? 0, projecaoMes },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/outbound/panel — registra uma atividade do SDR logado.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as {
      tipo?: string;
      resultado?: string;
      contact_id?: string;
      deal_id?: string;
      notes?: string;
    } | null;

    if (!body?.tipo || !TIPOS.includes(body.tipo)) {
      return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
    }
    const resultado =
      body.tipo === "call" && body.resultado && RESULTADOS.includes(body.resultado)
        ? body.resultado
        : null;

    const { error } = await ctx.supabase.from("sdr_activities").insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      tipo: body.tipo,
      resultado,
      contact_id: body.contact_id ?? null,
      deal_id: body.deal_id ?? null,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null,
    });
    if (error) {
      return NextResponse.json({ error: "Falha ao registrar atividade." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
