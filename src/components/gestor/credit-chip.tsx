"use client";

import { useEffect, useState } from "react";
import { Coins } from "lucide-react";

interface Saldo {
  total: number;
  usados: number;
  restantes: number;
}

// Chip discreto de saldo de créditos do mês. Fica âmbar quando resta ≤10%.
export function CreditChip() {
  const [saldo, setSaldo] = useState<Saldo | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch("/api/ai/creditos")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (ativo && j) setSaldo(j);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  if (!saldo) return null;
  const ilimitado = saldo.total < 0;
  const baixo = !ilimitado && saldo.restantes <= Math.max(1, saldo.total * 0.1);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
        baixo
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "border-border bg-muted/40 text-muted-foreground"
      }`}
      title="Créditos do Gestor neste mês"
    >
      <Coins className="h-3.5 w-3.5" />
      <span className="font-mono tabular-nums">
        {ilimitado ? "∞" : `${saldo.restantes}/${saldo.total}`}
      </span>
      <span className="hidden sm:inline">créditos</span>
    </span>
  );
}
