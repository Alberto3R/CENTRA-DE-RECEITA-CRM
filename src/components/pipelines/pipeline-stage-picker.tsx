"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/**
 * Par funil + etapa de destino.
 *
 * Usado por quem cria negócio sem passar pelo board: a criação em massa
 * a partir dos contatos selecionados e a importação de CSV. Carrega os
 * funis da conta, as etapas do funil escolhido e mantém a etapa sempre
 * coerente com o funil (troca de funil → cai na primeira etapa dele).
 */

interface PipelineOption {
  id: string;
  name: string;
}
interface StageOption {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

export interface PipelineStagePickerProps {
  pipelineId: string;
  stageId: string;
  onChange: (next: { pipelineId: string; stageId: string }) => void;
  disabled?: boolean;
  /** Rótulos menores, para caber dentro de outro formulário. */
  compact?: boolean;
}

export function PipelineStagePicker({
  pipelineId,
  stageId,
  onChange,
  disabled,
  compact,
}: PipelineStagePickerProps) {
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Funis da conta (RLS resolve o escopo). Seleciona o primeiro quando
  // ainda não há escolha, para o formulário nascer utilizável.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("pipelines")
        .select("id, name")
        .order("created_at");
      if (cancelado) return;
      const lista = (data ?? []) as PipelineOption[];
      setPipelines(lista);
      setLoading(false);
      if (!pipelineId && lista.length > 0) {
        onChange({ pipelineId: lista[0].id, stageId: "" });
      }
    })();
    return () => {
      cancelado = true;
    };
    // Só na montagem: recarregar a cada mudança de seleção causaria laço
    // com o onChange acima.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Etapas do funil escolhido.
  useEffect(() => {
    if (!pipelineId) {
      setStages([]);
      return;
    }
    let cancelado = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, position")
        .eq("pipeline_id", pipelineId)
        .order("position");
      if (cancelado) return;
      const lista = (data ?? []) as StageOption[];
      setStages(lista);
      // Etapa órfã (veio de outro funil) ou vazia → primeira do funil.
      if (lista.length > 0 && !lista.some((s) => s.id === stageId)) {
        onChange({ pipelineId, stageId: lista[0].id });
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  const selectClass =
    "h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary disabled:opacity-60";

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Carregando funis...
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        Nenhum funil cadastrado. Crie um funil em Funis antes de gerar
        negócios.
      </p>
    );
  }

  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2"}>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Funil de destino</Label>
        <select
          value={pipelineId}
          disabled={disabled}
          onChange={(e) =>
            onChange({ pipelineId: e.target.value, stageId: "" })
          }
          className={selectClass}
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Etapa</Label>
        <select
          value={stageId}
          disabled={disabled || stages.length === 0}
          onChange={(e) => onChange({ pipelineId, stageId: e.target.value })}
          className={selectClass}
        >
          {stages.length === 0 ? (
            <option value="">Funil sem etapas</option>
          ) : (
            stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))
          )}
        </select>
      </div>
    </div>
  );
}
