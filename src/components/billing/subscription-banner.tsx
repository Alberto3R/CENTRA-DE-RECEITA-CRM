"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// Estados de assinatura que sinalizam pendência de pagamento. Quando a
// conta está num destes, mostramos um aviso persistente no topo do
// dashboard (as features de IA já travam por crédito; o CRM segue aberto).
const PENDENTES = new Set([
  "past_due",
  "canceled",
  "cancelled",
  "incomplete",
  "unpaid",
]);

/**
 * Banner de assinatura vencida.
 *
 * Lê `accounts.subscription_status` (RLS deixa o membro ler a própria
 * conta). Sem assinatura ou com status ativo/trial → não renderiza nada.
 * O botão "Regularizar" (owner) leva à aba Assinatura, onde o portal do
 * Stripe resolve o pagamento.
 */
export function SubscriptionBanner() {
  const { accountId, isOwner } = useAuth();
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("accounts")
        .select("subscription_status")
        .eq("id", accountId)
        .maybeSingle<{ subscription_status: string | null }>();
      if (alive) setStatus(data?.subscription_status ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [accountId]);

  if (!status || !PENDENTES.has(status)) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300 sm:px-6">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <span>
          Pagamento da assinatura pendente — o acesso aos recursos pagos pode
          ser suspenso.
        </span>
      </span>
      {isOwner && (
        <Link
          href="/settings?tab=billing"
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700"
        >
          Regularizar
        </Link>
      )}
    </div>
  );
}
