"use client";

import { Link2, Trophy, Clock, Timer, UserX, TrendingDown, CalendarCheck } from "lucide-react";

import type { FunnelMetrics } from "@/lib/dashboard/queries";
import type { ResponseTimeSummary } from "@/lib/dashboard/types";
import { SkeletonCard } from "./skeleton";

// Seção "Funil & Performance" do Painel: taxa de conexão, taxa de conversão,
// ciclo de venda, tempo de resposta, leads sem follow-up humano e motivos
// de perda. Dados da RPC dashboard_funnel_metrics (+ responseTime que o
// Painel já carrega).

function pct(num: number, den: number): string {
  if (den <= 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

function fmtCycle(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const days = seconds / 86400;
  if (days >= 1) return `${days.toFixed(1)} dias`;
  const hours = seconds / 3600;
  if (hours >= 1) return `${hours.toFixed(1)} h`;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function fmtResp(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)} h`;
  return `${Math.round(minutes)} min`;
}

function Tile({
  icon: Icon,
  title,
  value,
  subtitle,
  tone,
}: {
  icon: typeof Link2;
  title: string;
  value: string;
  subtitle?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {title}
      </div>
      <div
        className={`mt-2 text-2xl font-bold ${tone === "warn" ? "text-amber-500" : "text-foreground"}`}
      >
        {value}
      </div>
      {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
    </div>
  );
}

export function FunnelPerformance({
  funnel,
  responseTime,
  loading,
}: {
  funnel: FunnelMetrics | null;
  responseTime: ResponseTimeSummary | null;
  loading: boolean;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">Funil &amp; Performance</h2>
        <p className="text-xs text-muted-foreground">
          Da entrada ao ganho — conexão, conversão, ciclo e o que precisa de atenção.
        </p>
      </div>

      {loading || !funnel ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Tile
              icon={Link2}
              title="Taxa de conexão"
              value={pct(funnel.reached_conn, funnel.with_conn_stage)}
              subtitle={`${funnel.reached_conn} de ${funnel.with_conn_stage} leads conectados`}
            />
            {/* Compromisso = visita, reunião, avaliação, test drive — o nome
                muda por segmento, a função é a mesma (migration 103). */}
            <Tile
              icon={CalendarCheck}
              title="Conexão → compromisso"
              value={pct(funnel.reached_comp ?? 0, funnel.conn_with_comp_stage ?? 0)}
              subtitle={`${funnel.reached_comp ?? 0} de ${funnel.conn_with_comp_stage ?? 0} conectados marcaram o próximo passo`}
            />
            <Tile
              icon={Trophy}
              title="Taxa de conversão"
              value={pct(funnel.won_from_conn, funnel.reached_conn)}
              subtitle={`${funnel.won_from_conn} ganho${funnel.won_from_conn === 1 ? "" : "s"} de quem conectou`}
            />
            <Tile
              icon={Clock}
              title="Ciclo de venda"
              value={fmtCycle(funnel.avg_cycle_seconds)}
              subtitle="média da entrada ao ganho"
            />
            <Tile
              icon={Timer}
              title="Tempo de resposta"
              value={fmtResp(responseTime?.thisWeekAvg ?? null)}
              subtitle="média da 1ª resposta (semana)"
            />
            <Tile
              icon={UserX}
              title="Sem follow-up humano"
              value={String(funnel.no_human_followup)}
              subtitle="conversas aguardando o time"
              tone={funnel.no_human_followup > 0 ? "warn" : "default"}
            />
          </div>

          {/* Motivos de perda */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingDown className="size-4 text-muted-foreground" />
              Motivos de perda
              {funnel.lost > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  ({funnel.lost} perdido{funnel.lost === 1 ? "" : "s"})
                </span>
              )}
            </div>
            {funnel.loss_reasons.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma perda registrada ainda. Ao marcar um negócio como perdido, escolha o
                motivo — eles aparecem aqui.
              </p>
            ) : (
              <div className="space-y-2">
                {funnel.loss_reasons.map((r) => {
                  const max = funnel.loss_reasons[0]?.count ?? 1;
                  return (
                    <div key={r.reason}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-foreground">{r.reason}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {r.count} · {funnel.lost ? Math.round((r.count / funnel.lost) * 100) : 0}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(r.count / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
