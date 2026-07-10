"use client";

// Análise de conversa — cola a transcrição, recebe as dimensões com evidência
// (timestamp real), perda estimada e prescrições.
//
// O backend persiste toda análise em `ai_analyses`; aqui carregamos o histórico
// (GET /api/ai/analise-call) e reabrimos qualquer análise antiga completa
// (GET /api/ai/analise-call/[id]). O resultado é apresentado de forma visual:
// veredito em destaque, barras de score por dimensão e prescrições acionáveis.

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  FileText,
  History,
  Loader2,
  MessageSquare,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
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

interface AnaliseResumo {
  id: string;
  created_at: string;
  nota: string | null;
  tipo: string | null;
  perda_estimada_reais: number | null;
  origem: string | null;
}

interface Contato {
  id: string;
  name: string | null;
  phone: string;
}

// Veredito por nota — cor + headline assertiva no topo do resultado.
const NOTA_META: Record<
  string,
  { cor: string; anel: string; titulo: string }
> = {
  A: {
    cor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    anel: "ring-emerald-500/40",
    titulo: "Call forte — conduziu bem",
  },
  B: {
    cor: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    anel: "ring-amber-500/40",
    titulo: "Deu pra fechar melhor",
  },
  C: {
    cor: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    anel: "ring-red-500/40",
    titulo: "Vazou dinheiro nessa call",
  },
};

// Cor da barra/score por faixa — leitura instantânea de onde está fraco.
function scoreTone(score: number): { bar: string; texto: string } {
  if (score >= 8)
    return {
      bar: "bg-emerald-500",
      texto: "text-emerald-600 dark:text-emerald-400",
    };
  if (score >= 5)
    return { bar: "bg-amber-500", texto: "text-amber-600 dark:text-amber-400" };
  return { bar: "bg-red-500", texto: "text-red-600 dark:text-red-400" };
}

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function AnaliseCallPage() {
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [analiseId, setAnaliseId] = useState<string | null>(null);

  // Histórico persistido — carregado do banco (some da tela era só falta de UI).
  const [historico, setHistorico] = useState<AnaliseResumo[]>([]);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [carregandoHist, setCarregandoHist] = useState(false);
  const [abrindoId, setAbrindoId] = useState<string | null>(null);

  // Busca de conversa do WhatsApp (preenche a transcrição a partir do inbox).
  const supabase = createClient();
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const [resultados, setResultados] = useState<Contato[]>([]);
  const [carregandoConversa, setCarregandoConversa] = useState(false);
  const [origem, setOrigem] = useState<string | null>(null);

  // Atendente da conversa — membro do CRM. A FUNÇÃO dele (profiles.funcao)
  // define a régua de análise (sdr = qualificar+agendar; demais = fechar).
  const [membros, setMembros] = useState<
    { user_id: string; full_name: string; funcao: string | null }[]
  >([]);
  const [membroId, setMembroId] = useState<string>("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/account/members");
        const j = await res.json();
        if (res.ok && Array.isArray(j.members)) setMembros(j.members);
      } catch {
        /* silencioso — o seletor apenas some se não carregar */
      }
    })();
  }, []);

  const membroSel = membros.find((m) => m.user_id === membroId);
  const reguaSdr = membroSel?.funcao === "sdr";

  const carregarHistorico = useCallback(async () => {
    setCarregandoHist(true);
    try {
      const res = await fetch("/api/ai/analise-call");
      if (!res.ok) return;
      const json = await res.json();
      setHistorico((json.analises as AnaliseResumo[]) ?? []);
    } catch {
      // histórico é secundário — não interrompe a página
    } finally {
      setCarregandoHist(false);
    }
  }, []);

  // Carrega o histórico ao abrir a página.
  useEffect(() => {
    void carregarHistorico();
  }, [carregarHistorico]);

  async function abrirAnalise(id: string) {
    setAbrindoId(id);
    setErro(null);
    try {
      const res = await fetch(`/api/ai/analise-call/${id}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Falha ao abrir a análise.");
        return;
      }
      setAnalise(json.analise as Analise);
      setAnaliseId(id);
      setHistoricoAberto(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      toast.error("Erro de rede ao abrir a análise.");
    } finally {
      setAbrindoId(null);
    }
  }

  async function buscar() {
    setBuscando(true);
    setBuscou(true);
    try {
      const term = q.trim();
      const safe = term.replace(/[,()*%]/g, "");
      const digits = term.replace(/\D/g, "");
      const nameHasLetters = /[a-zA-ZÀ-ú]/.test(safe);
      const parts: string[] = [];
      if (digits.length >= 3) parts.push(`phone.ilike.*${digits}*`);
      if (nameHasLetters) parts.push(`name.ilike.*${safe}*`);
      if (parts.length === 0) parts.push(`phone.ilike.*${digits || safe}*`);
      const { data } = await supabase
        .from("contacts")
        .select("id,name,phone")
        .or(parts.join(","))
        .limit(15);
      setResultados((data as Contato[]) ?? []);
    } catch {
      toast.error("Falha na busca.");
    } finally {
      setBuscando(false);
    }
  }

  async function carregarConversa(c: Contato) {
    setCarregandoConversa(true);
    try {
      const { data: convs } = await supabase
        .from("conversations")
        .select("id")
        .eq("contact_id", c.id)
        .order("last_message_at", { ascending: false })
        .limit(1);
      const convId = (convs as { id: string }[] | null)?.[0]?.id;
      if (!convId) {
        toast.error("Esse contato não tem conversa de WhatsApp.");
        return;
      }
      // Monta a transcrição no servidor — lá os áudios (mensagens de voz)
      // são transcritos via ElevenLabs Scribe e entram na análise.
      const res = await fetch("/api/ai/conversa-transcricao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error ?? "Falha ao carregar a conversa.");
        return;
      }
      if (!j.texto || !j.texto.trim()) {
        toast.error("A conversa não tem mensagens para analisar.");
        return;
      }
      setTexto(j.texto);
      setOrigem(c.name || c.phone);
      setBuscaAberta(false);
      if (j.audios > 0) {
        toast.success(
          `${j.audios} áudio(s) transcrito(s) e incluído(s) na conversa.`,
        );
      }
    } catch {
      toast.error("Falha ao carregar a conversa.");
    } finally {
      setCarregandoConversa(false);
    }
  }

  async function analisar() {
    setCarregando(true);
    setErro(null);
    setAnalise(null);
    setAnaliseId(null);
    try {
      const res = await fetch("/api/ai/analise-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto,
          origem: origem ?? undefined,
          ownerUserId: membroId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error ?? "Falha na análise.");
        return;
      }
      const nova = json.analise as Analise;
      setAnalise(nova);
      setAnaliseId((json.id as string) ?? null);
      // Já existe no banco — atualiza a lista local sem novo round-trip.
      if (json.id) {
        setHistorico((h) => [
          {
            id: json.id as string,
            created_at: (json.criadoEm as string) ?? new Date().toISOString(),
            nota: nova.nota,
            tipo: "call",
            perda_estimada_reais: nova.perda_estimada_reais,
            origem: origem ?? null,
          },
          ...h,
        ]);
      }
    } catch {
      setErro("Erro de rede ao analisar.");
    } finally {
      setCarregando(false);
    }
  }

  const dims = analise ? Object.entries(analise.dimensoes) : [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Análise de conversa"
        subtitle="Cole a transcrição da call (.txt ou .vtt) — ou busque uma conversa do WhatsApp. Veja onde o dinheiro vazou, quanto, e o que o vendedor deveria ter dito."
      />

      {/* Ações: buscar conversa do WhatsApp + abrir histórico salvo */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setBuscaAberta((v) => !v)}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <MessageSquare className="size-4" />
            Buscar conversa do WhatsApp
          </button>
          <button
            onClick={() => setHistoricoAberto((v) => !v)}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <History className="size-4" />
            Análises salvas
            {historico.length > 0 ? (
              <span className="rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">
                {historico.length}
              </span>
            ) : null}
          </button>
        </div>

        {historicoAberto ? (
          <div className="rounded-lg border border-border bg-card">
            {carregandoHist ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando…
              </div>
            ) : historico.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">
                Nenhuma análise salva ainda. As análises que você fizer ficam
                guardadas aqui.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {historico.map((h) => {
                  const meta = NOTA_META[h.nota ?? ""] ?? null;
                  return (
                    <li key={h.id}>
                      <button
                        onClick={() => abrirAnalise(h.id)}
                        disabled={abrindoId !== null}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-50 ${
                          h.id === analiseId ? "bg-primary/5" : ""
                        }`}
                      >
                        <span
                          className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-sm font-bold ${
                            meta?.cor ?? "border-border text-muted-foreground"
                          }`}
                        >
                          {h.nota ?? "–"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {h.origem?.trim() && h.origem !== "colado no app"
                              ? h.origem
                              : "Transcrição colada"}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {fmtData(h.created_at)}
                            {" · "}
                            {h.perda_estimada_reais != null
                              ? `Perda ${BRL(h.perda_estimada_reais)}`
                              : "perda não quantificada"}
                          </span>
                        </span>
                        {abrindoId === h.id ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {buscaAberta ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && buscar()}
                placeholder="Telefone ou nome do contato…"
                className="h-9 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
              />
              <Button onClick={buscar} disabled={buscando || q.trim().length < 2}>
                {buscando ? <Loader2 className="size-4 animate-spin" /> : "Buscar"}
              </Button>
            </div>
            {resultados.length > 0 ? (
              <ul className="mt-2 divide-y divide-border">
                {resultados.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => carregarConversa(c)}
                      disabled={carregandoConversa}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left transition-opacity hover:opacity-80 disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">
                          {c.name || "Sem nome"}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {c.phone}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-primary">Usar →</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : buscou && !buscando ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Nenhum contato encontrado.
              </p>
            ) : null}
          </div>
        ) : null}

        {origem ? (
          <p className="text-xs text-primary">
            Transcrição carregada da conversa de <strong>{origem}</strong>. Revise
            e clique em Analisar conversa.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {membros.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Atendente da conversa
            </span>
            <select
              value={membroId}
              onChange={(e) => setMembroId(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">Não informar (analisa como fechamento)</option>
              {membros.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name || "Sem nome"}
                  {m.funcao ? ` · ${m.funcao === "sdr" ? "SDR" : m.funcao}` : ""}
                </option>
              ))}
            </select>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                reguaSdr
                  ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                  : "bg-primary/15 text-primary"
              }`}
              title="A régua de análise vem da função comercial do atendente selecionado."
            >
              Régua: {reguaSdr ? "SDR — qualificar + agendar" : "Closer — fechar na conversa"}
            </span>
          </div>
        ) : null}
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
          {/* Veredito — nota grande + perda em destaque + headline assertivo */}
          <div
            className={`flex items-center gap-4 rounded-xl border bg-card p-5 ${
              NOTA_META[analise.nota]?.cor ?? "border-border"
            }`}
          >
            <span
              className={`inline-flex size-16 shrink-0 items-center justify-center rounded-xl border text-3xl font-black ring-4 ${
                NOTA_META[analise.nota]?.cor ?? ""
              } ${NOTA_META[analise.nota]?.anel ?? ""}`}
            >
              {analise.nota}
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold text-foreground">
                {NOTA_META[analise.nota]?.titulo ?? "Análise da call"}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                <TrendingDown className="size-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {analise.perda_estimada_reais != null ? (
                    <>
                      Perda estimada{" "}
                      <span className="font-mono text-base font-bold tabular-nums text-foreground">
                        {BRL(analise.perda_estimada_reais)}
                      </span>
                    </>
                  ) : (
                    "Perda não quantificável (faltam dados)"
                  )}
                </span>
              </div>
              {analise.perda_memoria_calculo ? (
                <p className="mt-1 text-xs text-muted-foreground">
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

          {/* Dimensões — linhas compactas recolhíveis: nome + barra + nota
              sempre visíveis (placar escaneável); resumo/evidências só ao
              expandir, pra não virar rolagem infinita. */}
          <ResultSection title="Dimensões avaliadas">
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">
              Toque numa dimensão para ver o resumo e as evidências.
            </p>
            <div className="flex flex-col gap-2">
              {dims.map(([dim, d]) => {
                // Blindagem: análises de formatos diferentes (ex.: funil) não
                // devem quebrar a tela ao serem abertas.
                const score = typeof d?.score === "number" ? d.score : 0;
                const evidencias = Array.isArray(d?.evidencias)
                  ? d.evidencias
                  : [];
                const tone = scoreTone(score);
                return (
                  <details
                    key={dim}
                    className="group rounded-lg border border-border bg-card"
                  >
                    <summary className="flex cursor-pointer list-none flex-col gap-2 p-3">
                      <div className="flex items-center gap-2">
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                        <h3 className="flex-1 truncate text-sm font-semibold capitalize text-foreground">
                          {dim.replaceAll("_", " ")}
                        </h3>
                        <span
                          className={`font-mono text-sm font-bold tabular-nums ${tone.texto}`}
                        >
                          {score}
                          <span className="text-xs text-muted-foreground">/10</span>
                        </span>
                      </div>
                      <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${tone.bar}`}
                          style={{ width: `${score * 10}%` }}
                        />
                      </div>
                    </summary>
                    <div className="border-t border-border px-3 pb-3 pt-2.5">
                      <p className="text-xs text-muted-foreground">{d?.resumo}</p>
                      {evidencias.length > 0 ? (
                        <ul className="mt-2 flex flex-col gap-1 border-l-2 border-border pl-3">
                          {evidencias.map((e, i) => (
                            <li key={i} className="text-xs text-foreground/80">
                              <span className="font-mono text-primary">
                                {e.timestamp}
                              </span>{" "}
                              — {e.comentario}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </details>
                );
              })}
            </div>
          </ResultSection>

          {/* Prescrições — cards numerados e acionáveis */}
          {analise.prescricoes.length > 0 ? (
            <ResultSection title="O que dizer da próxima vez">
              <ol className="flex flex-col gap-3">
                {analise.prescricoes.map((p, i) => (
                  <li
                    key={i}
                    className="flex gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      {p.dimensao ? (
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {p.dimensao.replaceAll("_", " ")}
                        </p>
                      ) : null}
                      <p className="text-sm font-medium text-foreground">
                        {p.o_que_dizer}
                      </p>
                      <p className="mt-1.5 rounded border-l-2 border-primary/40 bg-muted/50 p-2 text-xs italic text-muted-foreground">
                        “{p.exemplo_script}”
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </ResultSection>
          ) : null}

          {/* Próximos passos — checklist */}
          {analise.proximos_passos.length > 0 ? (
            <ResultSection title="Próximos passos">
              <ul className="flex flex-col gap-2">
                {analise.proximos_passos.map((passo, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    <span>{passo}</span>
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
