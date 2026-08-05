import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/account";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { DashboardShell } from "./dashboard-shell";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Login não é conta. Um usuário autenticado SEM conta (não comprou nem foi
  // convidado) não tem acesso ao CRM — vai pra /comecar escolher um plano. O
  // middleware já garante que aqui só chega quem está logado; se getCurrentAccount
  // falhar, é por falta de conta (ou sessão), e /comecar (protegido) resolve o
  // roteamento (manda pro login se não houver sessão).
  let ctx: Awaited<ReturnType<typeof getCurrentAccount>> | null = null;
  try {
    ctx = await getCurrentAccount();
  } catch {
    redirect("/comecar");
  }

  // O banner é renderizado no servidor a partir do contexto que este
  // layout já carrega. Nada de buscar estado de impersonation no
  // cliente: seria uma requisição extra em toda navegação, para todo
  // usuário, só para descobrir "não, você não está impersonando".
  return (
    <div className="flex h-screen flex-col">
      {ctx.impersonation && (
        <ImpersonationBanner
          accountName={ctx.account.name}
          reason={ctx.impersonation.reason}
          expiresAt={ctx.impersonation.expiresAt}
        />
      )}
      {/* min-h-0 para o shell encolher em vez de empurrar o banner
          para fora da tela quando o conteúdo é alto. */}
      <div className="min-h-0 flex-1">
        <DashboardShell>{children}</DashboardShell>
      </div>
    </div>
  );
}
