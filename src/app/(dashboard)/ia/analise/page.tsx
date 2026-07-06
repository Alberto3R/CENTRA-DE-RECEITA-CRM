"use client";

// Análise de conversa — cola a transcrição, recebe as dimensões com evidência
// (timestamp real), perda estimada e prescrições.

import { useState } from "react";
import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/gestor/page-header";
import { ResultSection, EmptyState } from "@/components/gestor/result-section";

interface Evidencia {
  timestamp: string;
  trecho: string;
  comentario: string;
}
interface Dimensao {
  score: number;
  evidencias: Evidencia[];
  resumo: string;
}
interface Prescricao {
  dimensao: string;
  o_que_dizer: string;
  exemplo_script: string;
}
interface Analise {
  dimensoes: Record<string, Dimensao>;
  nota: "A" | "B" | "C";
  perda_estimada_reais: number | null;
  perda_memoria_calculo: string | null;
  dados_faltantes: string[];
  prescricoes: Prescricao[];
  proximos_passos: string[];
}

const NOTA_COR: Record<string, string> = {
  A: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  B: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  C: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function AnaliseCallPage() {
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);

  async function analisar() {
    setCarregando(true);
    setErro(null);
    setAnalise(null);
    try {
      const res = await fetch("/api/ai/analise-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? "Falha na análise.");
        return;
      }
      setAnalise(json.analise as Analise);
    } catch {
      setErro("Erro de rede ao analisar.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Análise de conversa"
        subtitle="Cole a transcrição da call (.txt ou .vtt). Veja onde o dinheiro vazou, quanto, e o que o vendedor deveria ter dito."
      />

      <div className="flex flex-col gap-3">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Cole aqui a transcrição da call…"
          rows={10}
          className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              {texto.length.toLocaleString("pt-BR")}
            </span>{" "}
            caracteres
          </span>
          <Button onClick={analisar} disabled={carregando || texto.trim().length < 20}>
            {carregando ? "Analisando…" : "Analisar conversa"}
          </Button>
        </div>
      </div>

      {erro ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {erro}
        </div>
      ) : null}

      {carregando ? (
        <div className="flex flex-col gap-3">
          <div className="h-20 animate-pulse rounded-lg border border-border bg-muted/40" />
          <div className="h-44 animate-pulse rounded-lg border border-border bg-muted/40" />
        </div>
      ) : null}

      {!analise && !carregando && !erro ? (
        <EmptyState icon={FileText}>
          Cole uma transcrição acima e clique em Analisar conversa. O resultado
          aparece aqui.
        </EmptyState>
      ) : null}

      {analise ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <span
              className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-xl font-bold ${NOTA_COR[analise.nota] ?? ""}`}
            >
              {analise.nota}
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">
                {analise.perda_estimada_reais != null ? (
                  <>
                    Perda estimada:{" "}
                    <span className="font-mono tabular-nums">
                      {BRL(analise.perda_estimada_reais)}
                    </span>
                  </>
                ) : (
                  "Perda não quantificável (faltam dados)"
                )}
              </p>
              {analise.perda_memoria_calculo ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {analise.perda_memoria_calculo}
                </p>
              ) : null}
            </div>
          </div>

          {analise.dados_faltantes.length > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
              Para quantificar a perda, faltou: {analise.dados_faltantes.join(", ")}.
            </div>
          ) : null}

          <ResultSection title="Dimensões avaliadas">
            <ul className="divide-y divide-border">
              {Object.entries(analise.dimensoes).map(([dim, d]) => (
                <li key={dim} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium capitalize text-foreground">
                      {dim.replaceAll("_", " ")}
                    </h3>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {d.score}/10
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{d.resumo}</p>
                  {d.evidencias.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {d.evidencias.map((e, i) => (
                        <li key={i} className="text-xs text-foreground/80">
                          <span className="font-mono text-primary">{e.timestamp}</span>{" "}
                          — {e.comentario}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </ResultSection>

          {analise.prescricoes.length > 0 ? (
            <ResultSection title="O que dizer da próxima vez">
              <ul className="flex flex-col gap-3">
                {analise.prescricoes.map((p, i) => (
                  <li key={i} className="text-sm">
                    <p className="text-foreground">{p.o_que_dizer}</p>
                    <p className="mt-1 rounded bg-muted/50 p-2 text-xs italic text-muted-foreground">
                      “{p.exemplo_script}”
                    </p>
                  </li>
                ))}
              </ul>
            </ResultSection>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
