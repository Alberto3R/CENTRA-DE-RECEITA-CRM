// /api/scheduling/config — regras de agenda da conta (fuso, duração, buffer,
// horário de atendimento). GET p/ membros; PUT p/ admin+.
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

const DEFAULTS = {
  enabled: true,
  timezone: "America/Sao_Paulo",
  slot_minutes: 20,
  buffer_minutes: 10,
  advance_days: 7,
  business_hours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora inválida (HH:MM)");
const bodySchema = z.object({
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).optional(),
  slot_minutes: z.number().int().min(5).max(240).optional(),
  buffer_minutes: z.number().int().min(0).max(120).optional(),
  advance_days: z.number().int().min(1).max(60).optional(),
  business_hours: z
    .object({
      days: z.array(z.number().int().min(1).max(7)).min(1),
      start: hhmm,
      end: hhmm,
    })
    .optional(),
});

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const { data } = await ctx.supabase
      .from("scheduling_config")
      .select("enabled, timezone, slot_minutes, buffer_minutes, advance_days, business_hours")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    return NextResponse.json(data ?? DEFAULTS);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    let patch: z.infer<typeof bodySchema>;
    try {
      patch = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }
    const { error } = await ctx.supabase.from("scheduling_config").upsert(
      { account_id: ctx.accountId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "account_id" },
    );
    if (error) {
      console.error("[scheduling config] upsert:", error);
      return NextResponse.json({ error: "Falha ao salvar." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
