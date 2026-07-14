// GET /api/google/callback — retorno do consent do Google. Troca o code por
// tokens e guarda a conexão da conta (refresh token cifrado). Só admin+.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { requireRole } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { encrypt } from "@/lib/whatsapp/encryption";
import { exchangeCode, fetchGoogleEmail, publicOrigin } from "@/lib/google/oauth";

const DEST = (origin: string, s: string) => `${origin}/settings?tab=agenda&google=${s}`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  try {
    const ctx = await requireRole("admin");

    const jar = await cookies();
    const saved = jar.get("g_oauth_state")?.value;
    if (!code || !state || !saved || saved !== state) {
      return NextResponse.redirect(DEST(origin, "error"));
    }

    const tokens = await exchangeCode(code, origin);
    if (!tokens.refresh_token) {
      // Sem refresh token não dá pra manter a conexão (reconecte forçando consent).
      return NextResponse.redirect(DEST(origin, "no_refresh"));
    }
    const email = await fetchGoogleEmail(tokens.access_token);

    const admin = supabaseAdmin();
    await admin.from("google_connections").upsert(
      {
        account_id: ctx.accountId,
        google_email: email ?? "conta Google",
        refresh_token: encrypt(tokens.refresh_token),
        access_token: encrypt(tokens.access_token),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope ?? null,
        connected_by: ctx.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    // Garante a config de agenda default pra conta.
    await admin
      .from("scheduling_config")
      .upsert({ account_id: ctx.accountId }, { onConflict: "account_id", ignoreDuplicates: true });

    const res = NextResponse.redirect(DEST(origin, "connected"));
    res.cookies.delete("g_oauth_state");
    return res;
  } catch (err) {
    console.error("[google callback] erro:", err);
    return NextResponse.redirect(DEST(origin, "error"));
  }
}
