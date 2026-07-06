"use client";

// Avaliação do time — cadastra vendedores, gera parecer + PDI (rascunho que o
// gestor assina) e o ciclo de coaching da semana a partir das análises de cada um.

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/gestor/page-header";
import { ResultSection, EmptyState } from "@/components/gestor/result-section";

interface Seller {
  id: string;
  nome: string;
  funcao: string;
}

interface Pdi {
  parecer: {
    bandeira: string;
    leitura: string;
    pros: string[];
    contras: string[];
    dados_faltantes: string[];
  };
  plano_90d: {
    objetivo: string;
    metas: { meta: string; prazo_dias: number; como_medir: string }[];
    trilha_academy: string[];
    checkpoints: string[];
    criterio_de_saida: string;
  };
  recomendacao: string;
}

interface Ciclo {
  deal_coaching: { negocio_ou_trecho: string; evidencia: string; o_que_fazer_esta_semana: string };
  skill_coaching: { dimensao_alvo: string; diagnostico: string; exercicio: string; roteiro_role_play: string } | null;
  pauta_1on1: { resultado: string; rotina: string; ritual: string };
  combinado: { desafio: string; prazo: string };
  observacao_curva: string;
}

const BANDEIRA_COR: Record<string, string> = {
  verde: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amarela: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  vermelha: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};

export default function TimePage() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [nome, setNome] = useState("");
  const [funcao, setFuncao] = useState("closer");
  const [obs, setObs] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pdi, setPdi] = useState<Pdi | null>(null);
  const [ciclo, setCiclo] = useState<Ciclo | null>(null);

  async function carregar() {
    const res = await fetch("/api/ai/sellers");
    const json = await res.json();
    if (res.ok) setSellers(json.sellers ?? []);
  }
  useEffect(() => {
    void carregar();
  }, []);

  async function adicionar() {
    if (nome.trim().length < 2) return;
    const res = await fetch("/api/ai/sellers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, funcao }),
    });
    if (res.ok) {
      setNome("");
      void carregar();
    }
  }

  async function rodar(sellerId: string, tipo: "pdi" | "coaching") {
    setCarregando(true);
    setErro(null);
    setPdi(null);
    setCiclo(null);
    setSel(sellerId);
    try {
      const res = await fetch(`/api/ai/${tipo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tipo === "pdi" ? { sellerId, observacoes: obs } : { sellerId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? "Falha.");
        return;
      }
      if (tipo === "pdi") setPdi(json.pdi as Pdi);
      else setCiclo(json.ciclo as Ciclo);
    } catch {
      setErro("Erro de rede.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Avaliação do time"
        subtitle="Parecer + plano de 90 dias (rascunho que você assina) e o ciclo de coaching da semana, montado a partir das análises de cada vendedor."
      />

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-4">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do vendedor"
          className="w-48 rounded-lg border border-border bg-background p-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        />
        <select
          value={funcao}
          onChange={(e) => setFuncao(e.target.value)}
          className="rounded-lg border border-border bg-background p-2 text-sm text-foreground"
        >
          <option value="closer">Closer</option>
          <option value="sdr">SDR</option>
          <option value="social_seller">Social Seller</option>
          <option value="gestor">Gestor</option>
        </select>
        <Button onClick={adicionar}>Adicionar</Button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Observações do gestor (para o plano, opcional)
        <textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          rows={2}
          className="w-full resize-y rounded-lg border border-border bg-background p-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        />
      </label>

      {sellers.length === 0 ? (
        <EmptyState icon={Users}>
          Cadastre seu primeiro vendedor acima. Depois você gera o plano de 90
          dias e o ciclo de coaching de cada um.
        </EmptyState>
      ) : (
        <ResultSection title="Time">
          <ul className="divide-y divide-border">
            {sellers.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{s.nome}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {s.funcao.replaceAll("_", " ")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => rodar(s.id, "pdi")} disabled={carregando}>
                    Plano 90d
                  </Button>
                  <Button onClick={() => rodar(s.id, "coaching")} disabled={carregando}>
                    Coaching
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </ResultSection>
      )}

      {erro ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {erro}
        </div>
      ) : null}

      {carregando ? (
        <div className="h-44 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : null}

      {pdi && sel ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-lg border px-2 py-1 text-xs font-semibold uppercase ${BANDEIRA_COR[pdi.parecer.bandeira] ?? ""}`}
            >
              {pdi.parecer.bandeira}
            </span>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              rascunho — assinatura do gestor pendente
            </span>
          </div>
          <p className="text-sm text-foreground">{pdi.parecer.leitura}</p>
          <ResultSection title={`Plano de 90 dias — ${pdi.plano_90d.objetivo}`}>
            <ul className="divide-y divide-border">
              {pdi.plano_90d.metas.map((m, i) => (
                <li key={i} className="flex gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                  <span className="font-mono text-xs tabular-nums text-primary">
                    {m.prazo_dias}d
                  </span>
                  <span className="text-foreground/80">
                    {m.meta} <em className="text-muted-foreground">— {m.como_medir}</em>
                  </span>
                </li>
              ))}
            </ul>
            {pdi.plano_90d.trilha_academy.length > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Trilha: {pdi.plano_90d.trilha_academy.join(", ")}
              </p>
            ) : null}
          </ResultSection>
          <p className="text-sm font-medium text-primary">{pdi.recomendacao}</p>
        </div>
      ) : null}

      {ciclo ? (
        <div className="flex flex-col gap-4">
          <ResultSection title="Deal coaching (esta semana)">
            <p className="text-sm text-foreground/80">{ciclo.deal_coaching.o_que_fazer_esta_semana}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Evidência: {ciclo.deal_coaching.evidencia}
            </p>
          </ResultSection>

          {ciclo.skill_coaching ? (
            <ResultSection title={`Skill coaching · ${ciclo.skill_coaching.dimensao_alvo}`}>
              <p className="text-sm text-foreground/80">{ciclo.skill_coaching.diagnostico}</p>
              <p className="mt-2 rounded bg-muted/50 p-2 text-xs italic text-muted-foreground">
                Role play: {ciclo.skill_coaching.roteiro_role_play}
              </p>
            </ResultSection>
          ) : null}

          <ResultSection title="Pauta do 1:1">
            <dl className="flex flex-col gap-1.5 text-sm">
              <div>
                <dt className="inline font-medium text-foreground">Resultado: </dt>
                <dd className="inline text-foreground/80">{ciclo.pauta_1on1.resultado}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Rotina: </dt>
                <dd className="inline text-foreground/80">{ciclo.pauta_1on1.rotina}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Ritual: </dt>
                <dd className="inline text-foreground/80">{ciclo.pauta_1on1.ritual}</dd>
              </div>
            </dl>
          </ResultSection>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            <strong>Combinado (sugestão):</strong> {ciclo.combinado.desafio} — {ciclo.combinado.prazo}
          </div>
          <p className="text-xs text-muted-foreground">{ciclo.observacao_curva}</p>
        </div>
      ) : null}
    </div>
  );
}
