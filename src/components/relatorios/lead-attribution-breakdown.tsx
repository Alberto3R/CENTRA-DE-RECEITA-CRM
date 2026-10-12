"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

// Detalhe bruto da atribuição dos leads (era a página /relatorios inteira até
// a F3): contagem por campanha, ângulo, fonte e classificação, direto da
// lead_attribution. Útil para quem mede ângulo de criativo e gate de
// qualificação; o dinheiro (gasto, venda, receita) está no relatório acima.

interface Row {
  source: string | null;
  utm_campaign: string | null;
  ang: string | null;
  classificacao: string | null;
}

const NA = "(não informado)";

function tally(rows: Row[], key: keyof Row): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = r[key]?.trim() || NA;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
}

function AggCard({ title, data, total }: { title: string; data: [string, number][]; total: number }) {
  const max = data[0]?.[1] ?? 1;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem dados.</p>
      ) : (
        <div className="space-y-2.5">
          {data.map(([label, n]) => (
            <div key={label}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-sm text-foreground" title={label}>
                  {label}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {n} · {total ? Math.round((n / total) * 100) : 0}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LeadAttributionBreakdown({
  accountId,
  from,
  to,
}: {
  accountId: string;
  from: string;
  to: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("lead_attribution")
      .select("source, utm_campaign, ang, classificacao")
      .eq("account_id", accountId)
      .gte("created_at", `${from}T00:00:00-03:00`)
      .lt("created_at", `${to}T23:59:59.999-03:00`)
      .limit(10000)
      .then(({ data }) => {
        if (alive) setRows((data as Row[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [supabase, accountId, from, to]);

  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }
  const total = rows.length;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <AggCard title="Por campanha (utm_campaign)" data={tally(rows, "utm_campaign")} total={total} />
      <AggCard title="Por ângulo" data={tally(rows, "ang")} total={total} />
      <AggCard title="Por origem (source)" data={tally(rows, "source")} total={total} />
      <AggCard title="Por classificação" data={tally(rows, "classificacao")} total={total} />
    </div>
  );
}
