import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// GET /auth/callback — troca o `?code` (fluxo PKCE do Supabase) por uma
// sessão logada. É pra cá que o link de confirmação de e-mail (e reset de
// senha) deve apontar via `emailRedirectTo`. Sem esta rota, o link caía num
// 404 e o usuário não entrava mesmo com o e-mail já confirmado.
//
// `next` permite retomar um destino específico após confirmar — usado pelo
// fluxo de convite (/join/<token>). Default: /dashboard.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // `next` é sempre um caminho interno (começa com "/"); evita open-redirect.
      const dest = next.startsWith("/") ? next : "/dashboard";
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
