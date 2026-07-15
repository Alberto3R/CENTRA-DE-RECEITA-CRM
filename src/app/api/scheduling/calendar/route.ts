// /api/scheduling/calendar — QUAL agenda da conta Google o agente usa pra marcar.
// GET: agenda selecionada hoje + lista de agendas disponíveis (null se a conexão
//      foi autorizada antes do escopo de leitura → UI cai pro modo "digite o ID").
// PUT: grava a agenda escolhida em google_connections.calendar_id.
// Só admin+ (é configuração da conta).
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { listCalendars } from "@/lib/google/calendar";

export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const admin = supabaseAdmin();
    const { data: conn } = await admin
      .from("google_connections")
      .select("calendar_id")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!conn) {
      return NextResponse.json({ connected: false, calendarId: null, calendars: null });
    }
    let calendars: { id: string; summary: string; primary: boolean }[] | null = null;
    try {
      calendars = await listCalendars(ctx.accountId);
    } catch (e) {
      console.error("[scheduling calendar] listCalendars:", e);
    }
    return NextResponse.json({
      connected: true,
      calendarId: conn.calendar_id ?? "primary",
      calendars,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const putSchema = z.object({ calendarId: z.string().trim().min(1).max(300) });

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    let body: z.infer<typeof putSchema>;
    try {
      body = putSchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "Informe a agenda (calendarId)." }, { status: 400 });
    }
    const admin = supabaseAdmin();
    const { error } = await admin
      .from("google_connections")
      .update({ calendar_id: body.calendarId, updated_at: new Date().toISOString() })
      .eq("account_id", ctx.accountId);
    if (error) {
      console.error("[scheduling calendar] update:", error);
      return NextResponse.json({ error: "Falha ao salvar a agenda." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, calendarId: body.calendarId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
