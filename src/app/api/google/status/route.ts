// GET /api/google/status — a conta tem agenda Google conectada? Devolve só o
// estado (conectado + e-mail), nunca tokens. Qualquer membro da conta pode ver.
import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const { data } = await supabaseAdmin()
      .from("google_connections")
      .select("google_email")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    return NextResponse.json({
      connected: !!data,
      google_email: data?.google_email ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
