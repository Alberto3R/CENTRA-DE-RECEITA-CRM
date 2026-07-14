import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/auth/account";
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
  try {
    await getCurrentAccount();
  } catch {
    redirect("/comecar");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
