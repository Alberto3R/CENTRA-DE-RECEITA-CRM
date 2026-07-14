// POST /api/google/disconnect — desconecta a agenda Google da conta. Só admin+.
// Revoga o token no Google (best-effort) e apaga a conexão.
import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";

export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const admin = supabaseAdmin();

    const { data } = await admin
      .from("google_connections")
      .select("refresh_token")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (data?.refresh_token) {
      try {
        const token = decrypt(data.refresh_token);
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
      } catch (e) {
        console.error("[google disconnect] revoke falhou (segue apagando):", e);
      }
    }

    await admin.from("google_connections").delete().eq("account_id", ctx.accountId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
