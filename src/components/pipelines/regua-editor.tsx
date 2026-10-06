"use client";

import { Plus, RotateCcw, Trash2 } from "lucide-react";

import type { FuncaoEtapa } from "@/lib/pipelines/funcoes";
import { TOQUES_POR_FUNCAO, type CanalToque, type Toque } from "@/lib/pipelines/toques";

const CANAIS: CanalToque[] = ["WhatsApp", "Ligação", "E-mail"];

const campo =
  "rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-primary";

// Editor da régua de contato de UMA etapa (migration 105). Controlado: quem
// salva é o "Salvar alterações" do Gerenciar funil, junto com o resto.
export function ReguaEditor({
  toques,
  funcao,
  diasMax,
  onChange,
}: {
  toques: Toque[];
  funcao: FuncaoEtapa;
  diasMax: number | null | undefined;
  onChange: (t: Toque[]) => void;
}) {
  const padrao = TOQUES_POR_FUNCAO[funcao];
  const foraDoPrazo = diasMax != null && toques.some((t) => t.dia > diasMax);

  function mudar(i: number, parcial: Partial<Toque>) {
    onChange(toques.map((t, j) => (j === i ? { ...t, ...parcial } : t)));
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
      {toques.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Sem régua: o card não mostra o contato do dia e o agente não cobra o vendedor por esta
          etapa.
        </p>
      )}

      {toques.map((t, i) => (
        <div key={i} className="space-y-1 rounded-md bg-background/60 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Dia
              <input
                type="number"
                min={0}
                value={t.dia}
                onChange={(e) => mudar(i, { dia: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                className={`${campo} h-7 w-12 text-center`}
              />
            </label>
            <select
              value={t.canal}
              onChange={(e) => mudar(i, { canal: e.target.value as CanalToque })}
              className={`${campo} h-7`}
            >
              {CANAIS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              value={t.acao}
              onChange={(e) => mudar(i, { acao: e.target.value })}
              placeholder="O que fazer"
              className={`${campo} h-7 min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={() => onChange(toques.filter((_, j) => j !== i))}
              aria-label="Remover contato"
              className="rounded p-1 text-muted-foreground hover:text-red-400"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {t.canal !== "Ligação" && (
            <textarea
              value={t.mensagem ?? ""}
              onChange={(e) => mudar(i, { mensagem: e.target.value || undefined })}
              placeholder="Mensagem sugerida — use [colchetes] no que o vendedor completa"
              rows={2}
              className={`${campo} w-full resize-y py-1`}
            />
          )}
        </div>
      ))}

      {foraDoPrazo && (
        <p className="text-[11px] text-amber-500">
          Tem contato depois do prazo da etapa ({diasMax} dia(s)) — o card vai ficar vermelho antes
          do vendedor chegar nele.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            onChange([...toques, { dia: (toques.at(-1)?.dia ?? -1) + 1, canal: "WhatsApp", acao: "" }])
          }
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Contato
        </button>
        {padrao.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(padrao.map((t) => ({ ...t })))}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Usar a régua padrão da função
          </button>
        )}
      </div>
    </div>
  );
}
