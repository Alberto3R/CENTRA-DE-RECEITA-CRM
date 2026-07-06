"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreditCard, Loader2, Check } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { getPlan, PLANS, type PlanId } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

interface Saldo {
  plano: PlanId;
  total: number; // -1 = ilimitado
  usados: number;
  restantes: number; // -1 = ilimitado
}

function reais(n: number): string {
  return "R$ " + n.toLocaleString("pt-BR");
}

/**
 * Assinatura — plano atual, uso de créditos e ações de billing.
 *
 * Leitura via GET /api/ai/creditos (qualquer membro). Ações de compra
 * e gestão só para o owner: POST /api/billing/checkout e
 * POST /api/billing/portal, ambos devolvem { url } para redirecionar
 * ao Stripe. O portal 400 quando não há assinatura — tratado com toast.
 */
export function BillingSettings() {
  const { isOwner } = useAuth();
  const [saldo, setSaldo] = useState<Saldo | null>(null);
  const [loading, setLoading] = useState(true);
  const [ciclo, setCiclo] = useState<"mensal" | "anual">("mensal");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ai/creditos")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.error) setSaldo(d as Saldo);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Feedback ao voltar do Stripe Checkout (?status=success|cancel).
    const status = new URLSearchParams(window.location.search).get("status");
    if (status === "success")
      toast.success("Assinatura confirmada. Bem-vindo(a)!");
    else if (status === "cancel") toast.info("Checkout cancelado.");
  }, []);

  async function goCheckout(plan: "starter" | "pro") {
    setBusy(`${plan}:${ciclo}`);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, ciclo }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url)
        throw new Error(data?.error ?? "Falha ao iniciar o checkout");
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar o checkout");
      setBusy(null);
    }
  }

  async function goPortal() {
    setBusy("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.url)
        throw new Error(data?.error ?? "Nenhuma assinatura para gerenciar");
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Nenhuma assinatura para gerenciar",
      );
      setBusy(null);
    }
  }

  const planoAtual = getPlan(saldo?.plano);
  const ilimitado = saldo?.total === -1;
  const pctUso =
    saldo && saldo.total > 0
      ? Math.min(100, Math.round((saldo.usados / saldo.total) * 100))
      : 0;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Assinatura"
        description="Seu plano, créditos do Gestor e cobrança."
      />

      {/* Plano atual + créditos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <CreditCard className="size-4 text-primary" />
            Plano atual
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Os créditos alimentam as análises do Gestor Comercial. O CRM (inbox,
            contatos, funis) não consome crédito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando…
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold text-foreground">
                  {planoAtual.label}
                </span>
                {planoAtual.precoMensalReais > 0 && (
                  <span className="font-mono text-sm text-muted-foreground">
                    {reais(planoAtual.precoMensalReais)}/mês
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Créditos do mês</span>
                  <span className="font-mono">
                    {ilimitado
                      ? "Ilimitado"
                      : `${saldo?.usados ?? 0} / ${saldo?.total ?? 0}`}
                  </span>
                </div>
                {!ilimitado && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pctUso}%` }}
                    />
                  </div>
                )}
              </div>

              {isOwner && saldo?.plano !== "free" && (
                <Button
                  variant="outline"
                  onClick={goPortal}
                  disabled={busy === "portal"}
                >
                  {busy === "portal" ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Abrindo…
                    </>
                  ) : (
                    "Gerenciar assinatura"
                  )}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Planos (owner) */}
      {isOwner && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-foreground">Planos</CardTitle>
            <CardDescription className="text-muted-foreground">
              Escolha um plano para assinar ou trocar. A cobrança é via Stripe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
              {(["mensal", "anual"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCiclo(c)}
                  className={
                    "rounded-md px-3 py-1 capitalize transition-colors " +
                    (ciclo === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {c}
                  {c === "anual" ? " (2 meses grátis)" : ""}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(["starter", "pro"] as const).map((id) => {
                const p = PLANS[id];
                const preco =
                  ciclo === "anual"
                    ? (p.precoAnualMensalReais ?? p.precoMensalReais)
                    : p.precoMensalReais;
                const atual = saldo?.plano === id;
                return (
                  <div
                    key={id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        {p.label}
                      </span>
                      {atual && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          <Check className="size-3" /> Atual
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {reais(preco)}
                      <span className="text-muted-foreground">/mês</span>
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <li>{p.usuariosInclusos} usuários inclusos</li>
                      <li>{p.creditosMes} créditos de Gestor/mês</li>
                    </ul>
                    <Button
                      className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => goCheckout(id)}
                      disabled={busy === `${id}:${ciclo}`}
                    >
                      {busy === `${id}:${ciclo}` ? (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Abrindo…
                        </>
                      ) : atual ? (
                        "Trocar ciclo"
                      ) : (
                        "Assinar"
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Precisa de mais volume ou usuários? O plano{" "}
              <strong>Enterprise</strong> é consultivo — fale com o time
              comercial.
            </p>
          </CardContent>
        </Card>
      )}

      {!isOwner && !loading && (
        <p className="mt-4 text-xs text-muted-foreground">
          Apenas o dono da conta pode alterar a assinatura.
        </p>
      )}
    </section>
  );
}
