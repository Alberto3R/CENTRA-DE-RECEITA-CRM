"use client";

// Resultado do agente de atendimento — quantos leads ele atendeu, quantos
// qualificou, o que descobriu de cada um, quando passou pro consultor e o que
// virou venda. Lê a RPC agente_resultado (migration 110), que soma as
// avaliações da revisão automática (/api/ai-agent/avaliar, a cada 15 min).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/gestor/page-header";
import { ResultSection, EmptyState, Stat } from "@/components/gestor/result-section";
import {
  etapasDoFunil,
  formatarSegundos,
  rotuloOrigem,
  rotuloValor,
  type ResultadoAgente,
} from "@/lib/ai-agent/resultado";
import type { CampoQualificacao } from "@/lib/ai-agent/avaliar";

interface AgenteLite {
  id: string;
  name: string | null;
  qualificacao_campos: CampoQualificacao[] | null;
}

const PERIODOS = [
  { dias: 7, rotulo: "Últimos 7 dias" },
  { dias: 30, rotulo: "Últimos 30 dias" },
  { dias: 90, rotulo: "Últimos 90 dias" },
  { dias: 0, rotulo: "Desde o início" },
];

const INTERESSE: { chave: string; rotulo: string; cor: string }[] = [
  { chave: "alto", rotulo: "Alto", cor: "bg-emerald-500" },
  { chave: "medio", rotulo: "Médio", cor: "bg-sky-500" },
  { chave: "baixo", rotulo: "Baixo", cor: "bg-amber-500" },
  { chave: "nenhum", rotulo: "Nenhum", cor: "bg-red-500" },
  { chave: "sem_sinal", rotulo: "Sem sinal", cor: "bg-muted-foreground/40" },
];

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const USD = (v: number) =>
  `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NUM = (v: number) => v.toLocaleString("pt-BR");
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

const selectCls =
  "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function ResultadoDoAgentePage() {
  const { accountId } = useAuth();
  const [agentes, setAgentes] = useState<AgenteLite[]>([]);
  const [agenteId, setAgenteId] = useState<string>("");
  const [dias, setDias] = useState(30);
  const [origem, setOrigem] = useState<string | null>(null);
  // A resposta guarda para quais filtros foi pedida: "carregando" é ela não
  // bater com os filtros atuais (sem setState dentro do efeito).
  const [resposta, setResposta] = useState<{
    chave: string;
    dados: ResultadoAgente | null;
    erro: string | null;
  } | null>(null);
  const chave = `${accountId}|${agenteId}|${dias}|${origem}`;
  const carregando = resposta?.chave !== chave;
  const dados = resposta?.dados ?? null;
  const erro = resposta?.erro ?? null;

  useEffect(() => {
    if (!accountId) return;
    createClient()
      .from("ai_agent_config")
      .select("id, name, qualificacao_campos")
      .eq("account_id", accountId)
      .order("created_at")
      .then(({ data }) => setAgentes((data ?? []) as AgenteLite[]));
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    let cancelado = false;
    const pedido = `${accountId}|${agenteId}|${dias}|${origem}`;
    createClient()
      .rpc("agente_resultado", {
        p_account_id: accountId,
        p_agent_id: agenteId || null,
        p_desde: dias ? new Date(Date.now() - dias * 86400000).toISOString() : null,
        p_ate: null,
        p_origem: origem,
      })
      .then(({ data, error }) => {
        if (cancelado) return;
        setResposta({
          chave: pedido,
          dados: error ? null : (data as ResultadoAgente),
          erro: error ? "Não foi possível carregar o resultado agora." : null,
        });
      });
    return () => {
      cancelado = true;
    };
  }, [accountId, agenteId, dias, origem]);

  // Rótulos dos campos de qualificação: do agente escolhido, ou de todos.
  const rotulos = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agentes) {
      if (agenteId && a.id !== agenteId) continue;
      for (const c of a.qualificacao_campos ?? []) m.set(c.chave, c.rotulo);
    }
    return m;
  }, [agentes, agenteId]);

  const perfil = useMemo(() => {
    const porCampo = new Map<string, { valor: string; n: number }[]>();
    for (const p of dados?.perfil ?? []) {
      const lista = porCampo.get(p.campo) ?? [];
      lista.push({ valor: p.valor, n: p.n });
      porCampo.set(p.campo, lista);
    }
    return [...porCampo.entries()];
  }, [dados]);

  const f = dados?.funil;
  const vazio = !carregando && (!f || f.atendidos === 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="Resultado do agente"
        subtitle="O que o agente de atendimento entregou: quem ele atendeu, quem qualificou, o que descobriu e o que virou venda."
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectCls}
          value={agenteId}
          onChange={(e) => {
            setAgenteId(e.target.value);
            setOrigem(null);
          }}
          aria-label="Agente"
        >
          <option value="">Todos os agentes</option>
          {agentes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || "Agente"}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={dias}
          onChange={(e) => {
            setDias(Number(e.target.value));
            setOrigem(null);
          }}
          aria-label="Período"
        >
          {PERIODOS.map((p) => (
            <option key={p.dias} value={p.dias}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </div>

      {dados && dados.origens.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <OrigemChip ativo={origem === null} onClick={() => setOrigem(null)}>
            Todas as origens
          </OrigemChip>
          {dados.origens.map((o) => (
            <OrigemChip
              key={o.origem}
              ativo={origem === o.origem}
              onClick={() => setOrigem(o.origem)}
              title={o.origem}
            >
              <span className="max-w-[18rem] truncate">{rotuloOrigem(o.origem)}</span>
              <span className="text-muted-foreground">{o.n}</span>
            </OrigemChip>
          ))}
        </div>
      )}

      {erro && <p className="text-sm text-red-500">{erro}</p>}

      {carregando && !dados ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : vazio ? (
        <EmptyState icon={Bot}>
          Nenhuma conversa do agente avaliada neste período. A revisão roda a cada 15 minutos e
          lê as conversas depois que o consultor assume ou que elas param por 2 horas.
        </EmptyState>
      ) : dados && f ? (
        <div className={`flex flex-col gap-5 ${carregando ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-border bg-card px-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Leads atendidos" value={NUM(f.atendidos)} />
            <Stat label="Qualificados" value={`${NUM(f.qualificados)} · ${pct(f.qualificados, f.responderam)}`} />
            <Stat label="Mensagens do agente" value={NUM(dados.mensagens.agente)} />
            <Stat label="Mensagens dos leads" value={NUM(dados.mensagens.lead)} />
            <Stat label="1ª resposta (mediana)" value={formatarSegundos(dados.mensagens.resposta_mediana_seg)} />
            <Stat label="Vendas" value={f.ganhos ? `${NUM(f.ganhos)} · ${BRL(Number(f.valor_ganho))}` : "0"} />
          </div>

          <ResultSection title="Funil do agente">
            <div className="flex flex-col gap-2">
              {etapasDoFunil(f).map((e) => (
                <div key={e.chave} className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-3 sm:grid-cols-[12rem_1fr_5rem]">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{e.rotulo}</p>
                    <p className="hidden truncate text-[11px] text-muted-foreground sm:block">{e.ajuda}</p>
                  </div>
                  <div className="h-5 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary/80" style={{ width: `${Math.max(e.pct, e.n ? 1 : 0)}%` }} />
                  </div>
                  <p className="text-right font-mono text-sm tabular-nums text-foreground">
                    {NUM(e.n)} <span className="text-xs text-muted-foreground">{e.pct}%</span>
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Percentuais sobre os atendidos. &quot;Qualificados&quot; no topo da página é sobre quem respondeu ao agente.
            </p>
          </ResultSection>

          <div className="grid gap-5 lg:grid-cols-2">
            <ResultSection title="Quem passou a conversa pro consultor">
              <Barras
                total={f.atendidos}
                itens={[
                  { rotulo: "O agente encaminhou", n: dados.passagem.agente_encaminhou, cor: "bg-emerald-500" },
                  { rotulo: "Consultor assumiu antes de o lead responder", n: dados.passagem.humano_antes_do_lead_responder, cor: "bg-amber-500" },
                  { rotulo: "Consultor assumiu no meio da conversa", n: dados.passagem.humano_no_meio, cor: "bg-sky-500" },
                  { rotulo: "Sem consultor até agora", n: dados.passagem.sem_humano, cor: "bg-muted-foreground/40" },
                ]}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                O consultor entra, em mediana,{" "}
                <span className="font-medium text-foreground">
                  {formatarSegundos(
                    dados.passagem.minutos_ate_humano_mediana == null
                      ? null
                      : dados.passagem.minutos_ate_humano_mediana * 60,
                  )}
                </span>{" "}
                depois da 1ª mensagem do lead. Entrar antes de o lead responder tira do agente a chance de qualificar.
              </p>
            </ResultSection>

            <ResultSection title="Interesse ao fim do atendimento">
              <Barras
                total={f.atendidos}
                itens={INTERESSE.map((i) => ({
                  rotulo: i.rotulo,
                  n: dados.interesse[i.chave] ?? 0,
                  cor: i.cor,
                }))}
              />
            </ResultSection>
          </div>

          <ResultSection title="Quem são os leads (o que o agente descobriu)">
            {perfil.length === 0 ? (
              <p className="text-sm text-muted-foreground">O agente ainda não registrou dados de qualificação.</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {perfil.map(([campo, valores]) => (
                  <div key={campo}>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {rotulos.get(campo) ?? rotuloValor(campo)}
                    </p>
                    <Barras
                      total={valores.reduce((s, v) => s + v.n, 0)}
                      itens={valores.slice(0, 8).map((v) => ({
                        rotulo: rotuloValor(v.valor),
                        n: v.n,
                        cor: "bg-primary/70",
                      }))}
                    />
                  </div>
                ))}
              </div>
            )}
          </ResultSection>

          <div className="grid gap-5 lg:grid-cols-2">
            <ResultSection title="O que trava os leads (nas palavras deles)">
              {dados.dores.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum lead contou o que trava.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {dados.dores.map((d) => (
                    <li key={d.conversation_id} className="text-sm text-foreground">
                      <Link href={`/inbox?c=${d.conversation_id}`} className="hover:underline">
                        {d.dor}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </ResultSection>

            <ResultSection title="Qualidade e custo">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Stat label="Nota média do agente" value={dados.notas.media == null ? "—" : `${String(dados.notas.media).replace(".", ",")} / 5`} />
                <Stat label="Conversas com erro do agente" value={NUM(dados.notas.com_erro)} tone={dados.notas.com_erro ? "warn" : "default"} />
                <Stat label="Atendimentos fora do horário" value={`${NUM(dados.mensagens.fora_do_horario)} · ${pct(dados.mensagens.fora_do_horario, f.atendidos)}`} />
                <Stat label="Mensagens do consultor" value={NUM(dados.mensagens.humano)} />
                <Stat label="Custo do agente" value={dados.custo.turnos ? USD(Number(dados.custo.agente_usd)) : "—"} />
                <Stat label="Respostas que falharam" value={NUM(dados.custo.falhas)} tone={dados.custo.falhas ? "warn" : "default"} />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Custo e falhas contam a partir de 08/10/2026, quando o CRM passou a registrar cada resposta do agente. Fora do horário: antes das 8h, depois das 20h ou fim de semana.
              </p>
            </ResultSection>
          </div>

          <ResultSection title={`Conversas para revisar (${dados.problemas.length})`}>
            {dados.problemas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma conversa com erro ou nota baixa.</p>
            ) : (
              <ul className="divide-y divide-border">
                {dados.problemas.map((p) => (
                  <li key={p.conversation_id} className="flex gap-3 py-2.5">
                    <span
                      className={`mt-0.5 h-6 w-6 shrink-0 rounded text-center font-mono text-xs leading-6 ${
                        (p.nota ?? 3) <= 2 ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-500"
                      }`}
                    >
                      {p.nota ?? "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link href={`/inbox?c=${p.conversation_id}`} className="truncate text-sm font-medium text-foreground hover:underline">
                          {p.contato || "Contato"}
                        </Link>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {new Date(p.inicio_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                      {p.erro && <p className="text-xs text-red-500/90">{p.erro}</p>}
                      {p.resumo && <p className="text-xs text-muted-foreground">{p.resumo}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ResultSection>

          <p className="text-[11px] text-muted-foreground">
            Cada conversa é lida pela revisão automática no trecho em que só o agente falava, antes de o consultor assumir. Consultor entrar cedo ou lead que não responde não contam como erro do agente. Vendas e avanço vêm do funil, ao vivo.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function OrigemChip({
  ativo,
  onClick,
  title,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
        ativo
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Barras({
  total,
  itens,
}: {
  total: number;
  itens: { rotulo: string; n: number; cor: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {itens.map((i) => {
        const p = total > 0 ? Math.round((i.n / total) * 100) : 0;
        return (
          <div key={i.rotulo}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-foreground">{i.rotulo}</span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {NUM(i.n)} · {p}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-muted">
              <div className={`h-full rounded ${i.cor}`} style={{ width: `${p}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
