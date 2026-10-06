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

const TEXTO_PESO: Record<1 | 2 | 3, string> = {
  3: "text-red-400",
  2: "text-amber-500",
  1: "text-muted-foreground",
};

// Saúde do funil: lê os últimos 90 dias (RPC pipeline_saude, migration 106)
// e lista o que vale mexer — do que resolver hoje ao ajuste fino. Fica na
// tela do funil, acima das colunas: fechada, mostra o problema mais grave
// numa linha; aberta, a lista inteira.
export function SaudeFunil({
  pipelineId,
  stages,
  atualizarEm,
}: {
  pipelineId: string;
  stages: PipelineStage[];
  /** Muda quando os negócios mudam — refaz a leitura. */
  atualizarEm?: unknown;
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
  }, [pipelineId, supabase, atualizarEm]);

  const sugestoes = useMemo(
    () => (metricas ? sugestoesDoFunil(stages, metricas) : []),
    [metricas, stages],
  );

  if (!metricas) return null;

  const principal = sugestoes[0];

  return (
    <div
      className={`rounded-xl border ${principal ? COR_PESO[principal.peso] : "border-border bg-card"}`}
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={aberto}
      >
        <Activity className="h-4 w-4 shrink-0 text-primary" />
        <span className="shrink-0 font-medium text-foreground">Saúde do funil</span>
        <span
          className={`min-w-0 flex-1 truncate text-xs ${principal ? TEXTO_PESO[principal.peso] : "text-muted-foreground"}`}
        >
          {principal ? `· ${principal.titulo}` : "· tudo em ordem"}
        </span>
        {sugestoes.length > 1 && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            +{sugestoes.length - 1}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>
      {aberto && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            Últimos 90 dias deste funil. Prazo e régua de cada etapa ficam em Gerenciar funil.
          </p>
          {sugestoes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum sinal de problema. Volte depois que mais negócios passarem pelo funil.
            </p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {sugestoes.map((s) => (
                <div key={`${s.tipo}-${s.stage_id}`} className={`rounded-md border p-2 ${COR_PESO[s.peso]}`}>
                  <p className="text-xs font-medium text-foreground">{s.titulo}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{s.detalhe}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
