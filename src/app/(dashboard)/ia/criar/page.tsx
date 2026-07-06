"use client";

// Criar materiais comerciais — scripts, contornos de objeção, cadências de
// follow-up e campanhas, com o contexto (ICP, produto, oferta, tom) da conta.

import { useState } from "react";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/gestor/page-header";
import { ResultSection, EmptyState } from "@/components/gestor/result-section";
import { CopyButton } from "@/components/gestor/copy-button";

type Modo = "scripts" | "contragolpe" | "followup" | "campanhas";

const MODOS: { id: Modo; label: string; placeholder: string }[] = [
  { id: "scripts", label: "Script comercial", placeholder: "Ex.: cold call para clínicas odontológicas" },
  { id: "contragolpe", label: "Contorno de objeção", placeholder: "Contexto opcional (etapa do funil, produto…)" },
  { id: "followup", label: "Follow-up / anti no-show", placeholder: "Ex.: lead que pediu proposta e sumiu" },
  { id: "campanhas", label: "Campanha", placeholder: "Ex.: meta de R$ 200k em junho, time de 6 vendedores" },
];

interface Contorno {
  abordagem: string;
  o_que_dizer: string;
  exemplo_script: string;
  logica: string;
}
interface Contragolpe {
  objecao_resumida: string;
  tipo_objecao: string;
  contornos: Contorno[];
  pergunta_de_isolamento: string;
}

export default function CriarPage() {
  const [modo, setModo] = useState<Modo>("scripts");
  const [contexto, setContexto] = useState("");
  const [objecao, setObjecao] = useState("");
  const [tipoCampanha, setTipoCampanha] = useState<"gamificacao" | "oferta">("gamificacao");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [contragolpe, setContragolpe] = useState<Contragolpe | null>(null);

  const modoAtual = MODOS.find((m) => m.id === modo)!;

  function limparResultado() {
    setMarkdown(null);
    setContragolpe(null);
    setErro(null);
  }

  async function gerar() {
    setCarregando(true);
    limparResultado();
    try {
      const body: Record<string, unknown> = { contexto };
      if (modo === "contragolpe") body.objecao = objecao;
      if (modo === "campanhas") body.tipo = tipoCampanha;

      const res = await fetch(`/api/ai/${modo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? "Falha na geração.");
        return;
      }
      if (modo === "scripts") setMarkdown(json.conteudoMd);
      else if (modo === "campanhas") setMarkdown(json.materiaisMd);
      else if (modo === "followup")
        setMarkdown(`${json.cadenciaMd}\n\n---\n\n${json.comparecimentoMd}`);
      else if (modo === "contragolpe") setContragolpe(json.contragolpe as Contragolpe);
    } catch {
      setErro("Erro de rede ao gerar.");
    } finally {
      setCarregando(false);
    }
  }

  const podeGerar = modo === "contragolpe" ? objecao.trim().length > 3 : true;
  const semResultado = !markdown && !contragolpe && !carregando && !erro;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Criar materiais comerciais"
        subtitle="Scripts, contornos de objeção, cadências e campanhas — montados com o ICP, produto, oferta e tom da sua conta."
      />

      {/* Seletor de modo */}
      <div className="flex flex-wrap gap-2">
        {MODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setModo(m.id);
              limparResultado();
            }}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              modo === m.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        {modo === "contragolpe" ? (
          <textarea
            value={objecao}
            onChange={(e) => setObjecao(e.target.value)}
            placeholder="Cole a objeção real do cliente (ex.: 'tá caro', 'vou pensar', 'já tenho fornecedor')…"
            rows={3}
            className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
        ) : null}

        {modo === "campanhas" ? (
          <div className="flex gap-2">
            {(["gamificacao", "oferta"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipoCampanha(t)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  tipoCampanha === t
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {t === "gamificacao" ? "Gamificação" : "Oferta / educacional"}
              </button>
            ))}
          </div>
        ) : null}

        <textarea
          value={contexto}
          onChange={(e) => setContexto(e.target.value)}
          placeholder={modoAtual.placeholder}
          rows={3}
          className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="flex justify-end">
          <Button onClick={gerar} disabled={carregando || !podeGerar}>
            {carregando ? "Gerando…" : "Gerar"}
          </Button>
        </div>
      </div>

      {erro ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {erro}
        </div>
      ) : null}

      {carregando ? (
        <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : null}

      {semResultado ? (
        <EmptyState icon={PenLine}>
          Escolha o tipo de material, dê o contexto e clique em Gerar. O texto
          pronto aparece aqui, pronto para copiar.
        </EmptyState>
      ) : null}

      {markdown ? (
        <ResultSection title={modoAtual.label} action={<CopyButton text={markdown} />}>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {markdown}
          </div>
        </ResultSection>
      ) : null}

      {contragolpe ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">
              {contragolpe.objecao_resumida}
            </p>
            <span className="mt-1 inline-block rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {contragolpe.tipo_objecao}
            </span>
          </div>
          <ResultSection title="Como contornar">
            <ul className="divide-y divide-border">
              {contragolpe.contornos.map((c, i) => (
                <li key={i} className="py-3 first:pt-0 last:pb-0">
                  <h3 className="text-sm font-medium text-foreground">{c.abordagem}</h3>
                  <p className="mt-1 text-sm text-foreground/80">{c.o_que_dizer}</p>
                  <p className="mt-2 rounded bg-muted/50 p-2 text-xs italic text-muted-foreground">
                    “{c.exemplo_script}”
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">↳ {c.logica}</p>
                </li>
              ))}
            </ul>
          </ResultSection>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            <strong>Pergunta de isolamento:</strong> {contragolpe.pergunta_de_isolamento}
          </div>
        </div>
      ) : null}
    </div>
  );
}
