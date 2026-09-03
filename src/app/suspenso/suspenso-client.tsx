"use client";

import { useState } from "react";
import { Ban, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

interface SuspensoClientProps {
  accountName: string;
  suspendedAt: string | null;
  reason: string | null;
  isOwner: boolean;
}

export function SuspensoClient({
  accountName,
  suspendedAt,
  reason,
  isOwner,
}: SuspensoClientProps) {
  const [indoParaOPortal, setIndoParaOPortal] = useState(false);

  const desde = suspendedAt
    ? new Date(suspendedAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // Mesmo caminho do botão da aba Assinatura: o portal do Stripe roda
  // com service role, então continua acessível com a conta suspensa.
  async function reativar() {
    setIndoParaOPortal(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? "Nenhuma assinatura para gerenciar");
      }
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Nenhuma assinatura para gerenciar",
      );
      setIndoParaOPortal(false);
    }
  }

  async function sair() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card p-7 shadow-sm">
          <div className="flex size-11 items-center justify-center rounded-xl bg-red-500/10 ring-1 ring-red-500/25">
            <Ban className="size-5 text-red-500" />
          </div>

          <h1 className="mt-5 text-xl font-semibold text-foreground">
            Acesso suspenso
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {reason?.trim() ? `${reason.trim()} ` : ""}O acesso da conta{" "}
            <span className="font-medium text-foreground">{accountName}</span>{" "}
            {desde ? `foi suspenso em ${desde}.` : "está suspenso."}
          </p>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Seus dados continuam guardados — conversas, contatos e funis
            voltam exatamente como estavam assim que a assinatura for
            reativada.
          </p>

          <div className="mt-6 space-y-2">
            {isOwner ? (
              <Button
                onClick={reativar}
                disabled={indoParaOPortal}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {indoParaOPortal && <Loader2 className="size-4 animate-spin" />}
                Reativar assinatura
              </Button>
            ) : (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                Fale com o responsável pela conta para reativar a assinatura.
              </p>
            )}

            <Button
              variant="ghost"
              onClick={sair}
              className="w-full text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-4" />
              Sair
            </Button>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Precisa de ajuda? Fale com a Sales 3R.
        </p>
      </div>
    </main>
  );
}
