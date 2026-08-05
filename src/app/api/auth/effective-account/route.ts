import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/auth/account";
import { toErrorResponse } from "@/lib/auth/errors";

/**
 * GET /api/auth/effective-account
 *
 * Em qual conta o chamador está operando AGORA — que só difere da conta
 * do próprio perfil quando há uma sessão de impersonation ativa.
 *
 * Existe porque o cliente resolve a conta lendo `profiles.account_id`
 * direto, e esse valor é o do admin, não o do tenant. Sem este endpoint
 * o painel abriria o inbox do próprio admin com o banner dizendo que
 * ele está na conta do cliente — o pior tipo de bug de tenancy: o que
 * confunde quem está operando.
 *
 * Nada aqui concede acesso. Se o cliente ignorasse a resposta e
 * consultasse outra conta, o RLS devolveria vazio: a autoridade está na
 * policy, não neste JSON.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      accountId: ctx.accountId,
      accountName: ctx.account.name,
      role: ctx.role,
      impersonating: ctx.impersonation
        ? { expiresAt: ctx.impersonation.expiresAt }
        : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
