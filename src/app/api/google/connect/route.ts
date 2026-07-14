// GET /api/google/connect — inicia o OAuth do Google Calendar para a conta.
// Só admin+ conecta a agenda da conta. Redireciona pro consent do Google com um
// `state` anti-CSRF (também gravado em cookie httpOnly, conferido no callback).
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { buildAuthUrl, publicOrigin } from "@/lib/google/oauth";

export async function GET(request: Request) {
  try {
    await requireRole("admin");
    const origin = publicOrigin(request);
    const state = randomUUID();
    const res = NextResponse.redirect(buildAuthUrl(state, origin));
    res.cookies.set("g_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}
