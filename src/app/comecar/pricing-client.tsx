"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import { CheckCircle, Loader2, LogOut } from "lucide-react";

type Ciclo = "mensal" | "anual";

// Planos vendáveis nesta tela (enterprise é contato).
const COMPRAVEIS: PlanId[] = ["starter", "pro"];

function precoDoCiclo(planId: PlanId, ciclo: Ciclo): number {
  const p = PLANS[planId];
  if (ciclo === "anual" && p.precoAnualMensalReais != null) {
    return p.precoAnualMensalReais;
  }
  return p.precoMensalReais;
}

function PricingInner({ email }: { email: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const status = searchParams.get("status");

  const [ciclo, setCiclo] = useState<Ciclo>("mensal");
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Após o pagamento o Stripe volta com ?status=success, mas o webhook que
  // provisiona a conta é assíncrono. Ficamos re-renderizando o server component
  // (router.refresh) até a conta existir — aí o /comecar redireciona pro app.
  useEffect(() => {
    if (status !== "success") return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [status, router]);

  const assinar = useCallback(
    async (plan: PlanId) => {
      setError(null);
      setLoadingPlan(plan);
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan, ciclo }),
        });
        const data = (await res.json().catch(() => null)) as
          | { url?: string; error?: string }
          | null;
        if (!res.ok || !data?.url) {
          setError(data?.error ?? "Não foi possível iniciar o checkout.");
          setLoadingPlan(null);
          return;
        }
        window.location.href = data.url;
      } catch {
        setError("Falha de rede ao iniciar o checkout.");
        setLoadingPlan(null);
      }
    },
    [ciclo],
  );

  const sair = useCallback(async () => {
    await createClient().auth.signOut();
    router.replace("/login");
  }, [router]);

  if (status === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Pagamento confirmado!
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Estamos preparando sua conta. Isso leva alguns segundos — você será
              redirecionado automaticamente.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Escolha seu plano
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Você entrou como <span className="text-foreground">{email}</span>.
              Assine um plano para liberar seu CRM.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={sair}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </div>

        {/* Toggle mensal/anual */}
        <div className="mb-6 inline-flex rounded-lg border border-border bg-card p-1">
          {(["mensal", "anual"] as Ciclo[]).map((c) => (
            <button
              key={c}
              onClick={() => setCiclo(c)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                ciclo === c
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "mensal" ? "Mensal" : "Anual (2 meses grátis)"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {COMPRAVEIS.map((planId) => {
            const p = PLANS[planId];
            const preco = precoDoCiclo(planId, ciclo);
            const destaque = planId === "pro";
            return (
              <Card
                key={planId}
                className={`border-border bg-card ${
                  destaque ? "ring-2 ring-primary" : ""
                }`}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-foreground">
                    {p.label}
                    {destaque && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Mais popular
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    <span className="text-2xl font-semibold text-foreground">
                      R$ {preco}
                    </span>
                    <span className="text-muted-foreground">/mês</span>
                    {ciclo === "anual" && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (cobrança anual)
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-primary" />
                      {p.usuariosInclusos} usuários inclusos
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-primary" />
                      {p.creditosMes === -1
                        ? "Análises de IA ilimitadas"
                        : `${p.creditosMes} créditos de IA/mês`}
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-primary" />
                      CRM completo (inbox, funis, disparo)
                    </li>
                  </ul>
                  <Button
                    className="w-full"
                    variant={destaque ? "default" : "outline"}
                    disabled={loadingPlan !== null}
                    onClick={() => assinar(planId)}
                  >
                    {loadingPlan === planId ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Redirecionando…
                      </>
                    ) : (
                      "Assinar"
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Precisa de mais usuários ou plano Enterprise?{" "}
          <a
            href="mailto:contato@shortmidia.com.br?subject=Central%20de%20Receita%20-%20Enterprise"
            className="text-primary hover:underline"
          >
            Fale com a gente
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export function PricingClient({ email }: { email: string }) {
  return (
    <Suspense fallback={null}>
      <PricingInner email={email} />
    </Suspense>
  );
}
