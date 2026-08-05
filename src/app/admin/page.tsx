import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { TenantList, type TenantRow } from "./tenant-list";

export const metadata: Metadata = {
  title: "Plataforma",
  robots: { index: false, follow: false, nocache: true },
};

// Sempre dinâmico: os números mudam a cada mensagem recebida, e uma
// página cacheada de métricas de tenant seria pior que inútil.
export const dynamic = "force-dynamic";

/**
 * Painel de plataforma — a única tela que enxerga todos os tenants.
 *
 * Fora do grupo `(dashboard)` de propósito: aquele layout é a UI de um
 * tenant, e misturar as duas coisas é exatamente como se erra qual
 * conta está na tela.
 */
export default async function AdminPage() {
  try {
    await requirePlatformAdmin();
  } catch {
    // 404, não 403. Quem não é admin de plataforma não deve nem
    // descobrir que esta rota existe — um 403 confirma a existência.
    notFound();
  }

  const { data, error } = await supabaseAdmin().rpc("platform_tenant_overview");
  if (error) {
    console.error("[admin] falha ao carregar tenants:", error);
  }
  const tenants = (data ?? []) as TenantRow[];

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Plataforma
        </h1>
        <p className="text-sm text-muted-foreground">
          {tenants.length} {tenants.length === 1 ? "conta" : "contas"}. Entrar
          numa conta abre uma sessão de leitura registrada em log permanente.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          Não foi possível carregar os tenants. Verifique se a migration{" "}
          <code>084_platform_admin_impersonation.sql</code> foi aplicada.
        </p>
      ) : (
        <TenantList tenants={tenants} />
      )}
    </main>
  );
}
