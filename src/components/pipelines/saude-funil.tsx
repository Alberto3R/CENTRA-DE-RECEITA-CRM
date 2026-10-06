"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { sugestoesDoFunil, type MetricaEtapa } from "@/lib/pipelines/saude";
import type { PipelineStage } from "@/types";

const COR_PESO: Record<1 | 2 | 3, string> = {
  3: "border-red-500/40 bg-red-500/5",
  2: "border-amber-500/40 bg-amber-500/5",
  1: "border-border bg-card",
};

// Saúde do funil: lê os últimos 90 dias (RPC pipeline_saude, migration 106)
// e lista o que vale mexer — do que resolver hoje ao ajuste fino.
export function SaudeFunil({
  pipelineId,
  stages,
}: {
  pipelineId: string;
  stages: PipelineStage[];
}) {
  const supabase = createClient();
  const [metricas, setMetricas] = useState<MetricaEtapa[] | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let cancelado = false;
    supabase
      .rpc("pipeline_saude", { p_pipeline_id: pipelineId })
      .then(({ data }) => {
        if (cancelado) return;
        setMetricas(
          ((data ?? []) as MetricaEtapa[]).map((m) => ({
            ...m,
            entradas_90d: Number(m.entradas_90d),
            abertos: Number(m.abertos),
            parados: Number(m.parados),
            mediana_horas: m.mediana_horas == null ? null : Number(m.mediana_horas),
          })),
        );
      });
    return () => {
      cancelado = true;
    };
  }, [pipelineId, supabase]);

  const sugestoes = useMemo(
    () => (metricas ? sugestoesDoFunil(stages, metricas) : []),
    [metricas, stages],
  );

  if (!metricas) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <Activity className="h-4 w-4 text-primary" />
        <span className="flex-1 font-medium text-foreground">Saúde do funil</span>
        <span className={`text-xs ${sugestoes.length ? "text-amber-500" : "text-muted-foreground"}`}>
          {sugestoes.length ? `${sugestoes.length} sugestão(ões)` : "tudo em ordem"}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Últimos 90 dias deste funil.</p>
          {sugestoes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum sinal de problema. Volte depois que mais negócios passarem pelo funil.
            </p>
          ) : (
            sugestoes.map((s) => (
              <div key={`${s.tipo}-${s.stage_id}`} className={`rounded-md border p-2 ${COR_PESO[s.peso]}`}>
                <p className="text-xs font-medium text-foreground">{s.titulo}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.detalhe}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
