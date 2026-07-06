"use client";

// Análise de funil — sobre o CRM vivo: pauta da reunião de pipeline (lê os deals
// abertos) e raio-x do time (matriz atividade × eficiência).

import { useState } from "react";
import { GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/gestor/page-header";
import { ResultSection, EmptyState, Stat } from "@/components/gestor/result-section";

interface BlocoPauta {
  titulo: string;
  ponto: string;
}
interface DealRisco {
  deal: string;
  o_que_fazer: string;
}
interface InterpPauta {
  sinal_forecast: string;
  leitura_forecast: string;
  pauta_reuniao: BlocoPauta[];
  deals_em_risco: DealRisco[];
  gargalo_leitura: string;
  dados_faltantes: string[];
}
interface Resumo {
  pipeline: number;
  forecast: number;
  variancia: number | null;
  totalDeals: number;
  totalEmRisco: number;
}
interface PorVendedor {
  nome: string;
  leitura: string;
  prescricao_tipo_coaching: string;
  prescricao_acao: string;
}
interface InterpRaioX {
  por_vendedor: PorVendedor[];
  gargalo_time: string;
  recomendacao_geral: string;
  dados_faltantes: string[];
}

const BRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function FunilPage() {
  const [aba, setAba] = useState<"pauta" | "raiox">("pauta");
  const [meta, setMeta] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pauta, setPauta] = useState<{ resumo: Resumo; interp: InterpPauta } | null>(null);
  const [raiox, setRaiox] = useState<InterpRaioX | null>(null);

  async function rodar() {
    setCarregando(true);
    setErro(null);
    setPauta(null);
    setRaiox(null);
    try {
      const body = aba === "pauta" && meta.trim() ? { meta: Number(meta) } : {};
      const res = await fetch(`/api/ai/${aba === "pauta" ? "pauta-funil" : "raio-x"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? "Falha na análise.");
        return;
      }
      if (aba === "pauta") setPauta({ resumo: json.resumo, interp: json.interpretacao });
      else setRaiox(json.interpretacao as InterpRaioX);
    } catch {
      setErro("Erro de rede.");
    } finally {
      setCarregando(false);
    }
  }

  const semResultado = !pauta && !raiox && !carregando && !erro;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Análise de funil"
        subtitle="Lê os deals do seu CRM e monta a pauta da reunião de pipeline ou o raio-x do time — sem você digitar números."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {(["pauta", "raiox"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAba(a);
                setErro(null);
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                aba === a
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {a === "pauta" ? "Pauta do funil" : "Raio-X do time"}
            </button>
          ))}
        </div>

        {aba === "pauta" ? (
          <input
            type="number"
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            placeholder="Meta do período (R$, opcional)"
            className="w-56 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
        ) : null}

        <Button onClick={rodar} disabled={carregando} className="ml-auto">
          {carregando ? "Analisando…" : aba === "pauta" ? "Montar pauta" : "Rodar raio-x"}
        </Button>
      </div>

      {erro ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {erro}
        </div>
      ) : null}

      {carregando ? (
        <div className="flex flex-col gap-3">
          <div className="h-20 animate-pulse rounded-lg border border-border bg-muted/40" />
          <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
        </div>
      ) : null}

      {semResultado ? (
        <EmptyState icon={GitBranch}>
          {aba === "pauta"
            ? "Monte a pauta a partir dos deals abertos do seu CRM. O resumo e os pontos da reunião aparecem aqui."
            : "Rode o raio-x usando os deals atribuídos a cada vendedor. O diagnóstico do time aparece aqui."}
        </EmptyState>
      ) : null}

      {pauta ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
            <Stat label="Pipeline" value={BRL(pauta.resumo.pipeline)} />
            <Stat label="Forecast" value={BRL(pauta.resumo.forecast)} />
            <Stat label="Variância" value={BRL(pauta.resumo.variancia)} />
            <Stat
              label="Deals em risco"
              value={String(pauta.resumo.totalEmRisco)}
              tone={pauta.resumo.totalEmRisco > 0 ? "warn" : "default"}
            />
          </div>

          <ResultSection title="Leitura do forecast">
            <p className="text-sm text-foreground">{pauta.interp.leitura_forecast}</p>
          </ResultSection>

          {pauta.interp.pauta_reuniao.length > 0 ? (
            <ResultSection title="Pauta da reunião">
              <ol className="flex flex-col divide-y divide-border">
                {pauta.interp.pauta_reuniao.map((b, i) => (
                  <li key={i} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="text-sm font-medium text-foreground">{b.titulo}</h3>
                      <p className="mt-0.5 text-sm text-foreground/80">{b.ponto}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </ResultSection>
          ) : null}

          {pauta.interp.deals_em_risco.length > 0 ? (
            <ResultSection title="Deals em risco">
              <ul className="divide-y divide-border">
                {pauta.interp.deals_em_risco.map((d, i) => (
                  <li key={i} className="py-2.5 text-sm first:pt-0 last:pb-0">
                    <strong className="text-foreground">{d.deal}:</strong>{" "}
                    <span className="text-foreground/80">{d.o_que_fazer}</span>
                  </li>
                ))}
              </ul>
            </ResultSection>
          ) : null}
        </div>
      ) : null}

      {raiox ? (
        <div className="flex flex-col gap-4">
          <ResultSection title="Gargalo do time">
            <p className="text-sm text-foreground/80">{raiox.gargalo_time}</p>
            <p className="mt-2 text-sm font-medium text-primary">
              {raiox.recomendacao_geral}
            </p>
          </ResultSection>

          <ResultSection title="Por vendedor">
            <ul className="divide-y divide-border">
              {raiox.por_vendedor.map((v, i) => (
                <li key={i} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-foreground">{v.nome}</h3>
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {v.prescricao_tipo_coaching}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground/80">{v.leitura}</p>
                  <p className="mt-1 text-xs text-muted-foreground">↳ {v.prescricao_acao}</p>
                </li>
              ))}
            </ul>
          </ResultSection>
        </div>
      ) : null}
    </div>
  );
}
