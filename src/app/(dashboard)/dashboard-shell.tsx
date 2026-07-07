"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { IncomingCallModal } from "@/components/whatsapp/incoming-call-modal";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { AccountThemeSync } from "@/components/theme/account-theme-sync";
import { SubscriptionBanner } from "@/components/billing/subscription-banner";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Auto-recupera de chunks obsoletos após um deploy. Quando uma versão
  // nova sobe, os nomes dos chunks antigos passam a dar 404; uma navegação
  // client-side pra uma rota ainda-não-carregada falha em silêncio ("não
  // carrega nada"). Detectamos esse erro e recarregamos a página uma vez
  // pra puxar o build novo. O guard em sessionStorage evita loop de reload.
  useEffect(() => {
    const onChunkError = (e: Event) => {
      const msg =
        (e as ErrorEvent)?.message ||
        (e as PromiseRejectionEvent)?.reason?.message ||
        "";
      if (
        /ChunkLoadError|Loading chunk [\d]+ failed|dynamically imported module|importing a module script failed/i.test(
          msg,
        )
      ) {
        if (!sessionStorage.getItem("__chunk_reload__")) {
          sessionStorage.setItem("__chunk_reload__", "1");
          window.location.reload();
        }
      }
    };
    window.addEventListener("error", onChunkError);
    window.addEventListener("unhandledrejection", onChunkError);
    return () => {
      window.removeEventListener("error", onChunkError);
      window.removeEventListener("unhandledrejection", onChunkError);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      {/* Aplica a cor de destaque da marca ativa (paleta por conta). */}
      <AccountThemeSync />
      {/* Ouvinte global de chamadas WhatsApp entrantes (Calling API). */}
      <IncomingCallModal />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Aviso persistente quando a assinatura está com pagamento pendente. */}
        <SubscriptionBanner />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
