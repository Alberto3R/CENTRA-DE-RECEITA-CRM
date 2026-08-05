import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/errors";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * GET /api/admin/tenants
 *
 * Lista todos os tenants com métricas, para o painel de plataforma.
 *
 * Atravessa a isolação entre contas de propósito — é a única rota do
 * sistema que faz isso — então `requirePlatformAdmin()` é a primeira
 * linha, antes de qualquer leitura. A agregação vem de
 * `platform_tenant_overview()`, cujo EXECUTE é exclusivo de
 * service_role: mesmo que esta rota fosse chamada por engano com o
 * cliente do usuário, o Postgres recusaria.
 */
export async function GET() {
  try {
    await requirePlatformAdmin();

    const { data, error } = await supabaseAdmin().rpc(
      "platform_tenant_overview",
    );
    if (error) {
      console.error("[admin/tenants] falha na visão geral:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os tenants." },
        { status: 500 },
      );
    }

    return NextResponse.json({ tenants: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
