"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Ban } from "lucide-react";

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

interface ContaBilling {
  subscription_status: string | null;
  access_suspends_at: string | null;
  suspension_reason: string | null;
}

/** Quebra um intervalo em ms nos campos da contagem regressiva. */
export function partesDaContagem(ms: number): {
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
} {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    dias: Math.floor(total / 86400),
    horas: Math.floor((total % 86400) / 3600),
    minutos: Math.floor((total % 3600) / 60),
    segundos: total % 60,
  };
}

/**
 * Texto da contagem regressiva. Acima de um dia o segundo não interessa
 * ("faltam 6 dias e 3h"); no último dia ele passa a interessar muito,
 * então vira relógio ("faltam 05:12:44").
 */
export function textoDaContagem(ms: number): string {
  const { dias, horas, minutos, segundos } = partesDaContagem(ms);
  if (dias > 0) {
    return `${dias} dia${dias === 1 ? "" : "s"} e ${horas}h${
      dias === 1 ? ` ${String(minutos).padStart(2, "0")}min` : ""
    }`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(horas)}:${pad(minutos)}:${pad(segundos)}`;
}

/**
 * Aviso fixado de assinatura.
 *
 * Dois níveis:
 *  1. `accounts.access_suspends_at` no futuro → aviso VERMELHO fixado com
 *     contagem regressiva até o corte de acesso (migração 094).
 *  2. Sem prazo, mas `subscription_status` pendente → aviso âmbar de
 *     sempre (pagamento pendente).
 *
 * Lê `accounts` direto (RLS deixa o membro ler a própria conta). O botão
 * "Reativar assinatura" (owner) leva à aba Assinatura, onde o portal do
 * Stripe resolve o pagamento.
 */
export function SubscriptionBanner() {
  const { accountId, isOwner } = useAuth();
  const [conta, setConta] = useState<ContaBilling | null>(null);
  const [agora, setAgora] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("accounts")
        .select("subscription_status, access_suspends_at, suspension_reason")
        .eq("id", accountId)
        .maybeSingle<ContaBilling>();

      if (!error) {
        if (alive) setConta(data ?? null);
        return;
      }

      // Colunas da migração 094 ainda não existem neste banco (código
      // subiu antes da migração). Cai para o aviso antigo em vez de
      // sumir com o banner inteiro.
      const { data: basico } = await supabase
        .from("accounts")
        .select("subscription_status")
        .eq("id", accountId)
        .maybeSingle<{ subscription_status: string | null }>();
      if (alive) {
        setConta(
          basico
            ? {
                subscription_status: basico.subscription_status,
                access_suspends_at: null,
                suspension_reason: null,
              }
            : null,
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [accountId]);

  const prazo = conta?.access_suspends_at
    ? new Date(conta.access_suspends_at).getTime()
    : null;
  const temPrazo = prazo !== null && Number.isFinite(prazo);

  // O relógio só corre quando há prazo para contar — sem isso o banner
  // âmbar (sem contagem) re-renderizaria de segundo em segundo à toa.
  useEffect(() => {
    if (!temPrazo) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [temPrazo]);

  if (!conta) return null;

  if (temPrazo) {
    const restante = prazo - agora;
    const vencido = restante <= 0;
    const motivo =
      conta.suspension_reason?.trim() || "Assinatura cancelada.";
    const dataLegivel = new Date(prazo).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <div className="flex flex-col gap-2 border-b border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:text-red-300">
        <span className="flex items-start gap-2 sm:items-center">
          {vencido ? (
            <Ban className="mt-0.5 size-4 shrink-0 sm:mt-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 sm:mt-0" />
          )}
          <span>
            <span className="font-semibold">{motivo}</span>{" "}
            {vencido ? (
              <>O acesso ao CRM está suspenso desde {dataLegivel}.</>
            ) : (
              <>
                O acesso ao CRM será suspenso em{" "}
                <span
                  className="font-mono font-semibold tabular-nums"
                  aria-live="off"
                >
                  {textoDaContagem(restante)}
                </span>{" "}
                <span className="text-red-700/80 dark:text-red-300/80">
                  ({dataLegivel})
                </span>
                .
              </>
            )}
          </span>
        </span>
        {isOwner && (
          <Link
            href="/settings?tab=billing"
            className="shrink-0 self-start rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 sm:self-auto"
          >
            Reativar assinatura
          </Link>
        )}
      </div>
    );
  }

  const status = conta.subscription_status;
  if (!status || !PENDENTES.has(status)) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 sm:px-6 dark:text-amber-300">
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
