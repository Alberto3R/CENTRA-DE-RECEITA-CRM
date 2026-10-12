"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  resultOf,
  rowMetrics,
  totals,
  type AcquisitionReport,
  type CampaignRow,
  type ChannelRow,
} from "@/lib/acquisition/report";

// Corpo do Relatório de Aquisição: só apresentação, recebe o resultado pronto
// do RPC acquisition_report (mig 114). A página cuida de período e carga.

function money(v: number | null, currency: string, decimals = 0): string {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(decimals)}`;
  }
}
const int = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
const ratio = (v: number | null) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")}×`);

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums text-foreground",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

const th = "px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

function ChannelTable({ rows, currency, settings }: { rows: ChannelRow[]; currency: string; settings: AcquisitionReport["settings"] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <th className={cn(th, "text-left")}>Canal</th>
            <th className={th}>Leads</th>
            <th className={th}>Vendas</th>
            <th className={th}>Conversão</th>
            <th className={th}>Receita</th>
            <th className={th}>Investimento</th>
            <th className={th}>CPL</th>
            <th className={th}>CAC</th>
            <th className={th}>ROAS</th>
            <th className={th}>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = rowMetrics(r);
            const res = resultOf(r.revenue, r.spend, settings);
            return (
              <tr key={r.channel_id ?? "none"} className="border-b border-border last:border-0">
                <td className={cn(td, "text-left font-medium", !r.channel_id && "text-muted-foreground")}>{r.name}</td>
                <td className={td}>{int(r.leads)}</td>
                <td className={td}>{int(r.sales)}</td>
                <td className={td}>{pct(m.conversion)}</td>
                <td className={td}>{money(r.revenue, currency)}</td>
                <td className={td}>{r.spend > 0 ? money(r.spend, currency) : "—"}</td>
                <td className={td}>{money(m.cpl, currency, 2)}</td>
                <td className={td}>{money(m.cac, currency)}</td>
                <td className={td}>{ratio(m.roas)}</td>
                <td className={cn(td, res < 0 && "text-destructive")}>{money(res, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CampaignTable({ rows, currency }: { rows: CampaignRow[]; currency: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma campanha com gasto ou lead no período.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <th className={cn(th, "text-left")}>Campanha</th>
            <th className={th}>Investimento</th>
            <th className={th} title="Leads que a Meta contou">Leads (Meta)</th>
            <th className={th} title="Negócios que chegaram no CRM">Leads (CRM)</th>
            <th className={th}>Vendas</th>
            <th className={th}>Receita</th>
            <th className={th}>CPL (CRM)</th>
            <th className={th}>ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r) => {
            const m = rowMetrics(r);
            const vaza = r.meta_leads >= 10 && r.leads < r.meta_leads * 0.7;
            return (
              <tr key={r.campaign_key} className="border-b border-border last:border-0">
                <td className={cn(td, "max-w-[280px] truncate text-left")} title={`${r.campaign_name ?? ""} (${r.campaign_key})`}>
                  {r.campaign_name ?? r.campaign_key}
                </td>
                <td className={td}>{r.spend > 0 ? money(r.spend, currency) : "—"}</td>
                <td className={td}>{r.meta_leads > 0 ? int(r.meta_leads) : "—"}</td>
                <td className={cn(td, vaza && "font-semibold text-amber-600")}>
                  {int(r.leads)}
                  {vaza && <span className="sr-only"> (menos que a Meta)</span>}
                </td>
                <td className={td}>{int(r.sales)}</td>
                <td className={td}>{money(r.revenue, currency)}</td>
                <td className={td}>{money(m.cpl, currency, 2)}</td>
                <td className={td}>{ratio(m.roas)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Investimento × receita por semana — mesma unidade, um eixo só. */
function WeeklyBars({ weekly, currency }: { weekly: AcquisitionReport["weekly"]; currency: string }) {
  const max = Math.max(1, ...weekly.map((w) => Math.max(Number(w.spend) || 0, Number(w.revenue) || 0)));
  if (weekly.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Investimento × receita por semana</h3>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-muted-foreground/50" /> Investimento
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-primary" /> Receita
          </span>
        </div>
      </div>
      <div className="flex h-36 items-end gap-1.5 overflow-x-auto border-b border-border pb-px">
        {weekly.map((w) => {
          const spend = Number(w.spend) || 0;
          const revenue = Number(w.revenue) || 0;
          const d = new Date(`${w.week}T12:00:00`);
          const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
          const tip = `Semana de ${label}\nInvestimento: ${money(spend, currency)}\nReceita: ${money(revenue, currency)}\nLeads: ${w.leads} · Vendas: ${w.sales}`;
          return (
            <div key={w.week} className="flex h-full min-w-[22px] flex-1 flex-col justify-end" title={tip}>
              <div className="flex h-full items-end justify-center gap-0.5">
                <div
                  className="w-1/2 max-w-[14px] rounded-t-[4px] bg-muted-foreground/50"
                  style={{ height: `${(spend / max) * 100}%` }}
                />
                <div
                  className="w-1/2 max-w-[14px] rounded-t-[4px] bg-primary"
                  style={{ height: `${(revenue / max) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 overflow-hidden text-[10px] text-muted-foreground">
        {weekly.map((w, i) => (
          <div key={w.week} className="min-w-[22px] flex-1 text-center">
            {i % Math.ceil(weekly.length / 8) === 0
              ? new Date(`${w.week}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
              : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AcquisitionReportView({
  report,
  hasChannels,
  canEditSettings,
}: {
  report: AcquisitionReport;
  hasChannels: boolean;
  canEditSettings: boolean;
}) {
  const t = totals(report);
  const cur = report.currency ?? "BRL";
  const syncErrors = report.ad_accounts.filter((a) => a.last_sync_error);
  const otherCurrency = report.spend_currencies.filter((c) => c !== cur);
  return (
    <>
          {/* Avisos: o que torna o número menos confiável */}
          <div className="mt-5 space-y-2">
            {!hasChannels && (
              <Alert>
                Esta conta ainda não tem canais definidos, então tudo aparece como &quot;Não identificado&quot;.{" "}
                {canEditSettings ? (
                  <Link href="/settings?tab=acquisition" className="font-medium text-primary underline">
                    Configurar canais
                  </Link>
                ) : (
                  "Peça a um administrador para configurar em Configurações → Aquisição."
                )}
              </Alert>
            )}
            {hasChannels && t.leads > 0 && t.unidentifiedLeads / t.leads > 0.2 && (
              <Alert>
                {pct(t.unidentifiedLeads / t.leads)} dos leads do período não têm canal identificado.{" "}
                {canEditSettings && (
                  <Link href="/settings?tab=acquisition" className="font-medium text-primary underline">
                    Ver origens sem canal
                  </Link>
                )}
              </Alert>
            )}
            {t.wonNoValue > 0 && (
              <Alert>
                {t.wonNoValue} {t.wonNoValue === 1 ? "venda foi marcada" : "vendas foram marcadas"} como ganho sem
                valor. Elas contam como venda, mas não entram na receita.
              </Alert>
            )}
            {syncErrors.length > 0 && (
              <Alert>
                O gasto de {syncErrors.length === 1 ? "1 conta de anúncio" : `${syncErrors.length} contas de anúncio`}{" "}
                não está sendo lido ({syncErrors.map((a) => a.name || a.external_id).join(", ")}), então o investimento
                está incompleto.
              </Alert>
            )}
            {otherCurrency.length > 0 && (
              <Alert>
                Há gasto em {otherCurrency.join(", ")} somado como {cur}, sem conversão de câmbio.
              </Alert>
            )}
          </div>

          {/* Números principais */}
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Investimento" value={t.spend > 0 ? money(t.spend, cur) : "—"} hint="mídia paga" />
            <Tile label="Receita" value={money(t.revenue, cur)} hint={`${int(t.sales)} vendas`} />
            <Tile
              label="Resultado"
              value={money(t.result, cur)}
              hint={t.marginKnown ? "receita × margem − comissão − investimento" : "margem não informada (100%)"}
              tone={t.result < 0 ? "bad" : undefined}
            />
            <Tile label="ROAS" value={ratio(t.roas)} hint="receita ÷ investimento" />
            <Tile label="CAC geral" value={money(t.cac, cur)} hint="mídia ÷ todas as vendas" />
            <Tile label="CPL" value={money(t.cpl, cur, 2)} hint={`${int(t.leads)} leads · conv. ${pct(t.conversion)}`} />
          </div>

          <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">Por canal</h2>
          <ChannelTable rows={report.channels} currency={cur} settings={report.settings} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Canal sem investimento registrado aparece com custo &quot;—&quot;: o custo é desconhecido, não zero.
            Crédito da venda: {report.settings.attribution_model === "first_touch" ? "primeiro" : "último"} contato,
            janela de {report.settings.attribution_window_days} dias.
          </p>

          <div className="mt-6">
            <WeeklyBars weekly={report.weekly} currency={cur} />
          </div>

          <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">Por campanha</h2>
          <CampaignTable rows={report.campaigns} currency={cur} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Em destaque: campanha em que o CRM recebeu bem menos leads do que a Meta contou (formulário sem
            integração, ou lead que não virou negócio).
          </p>

    </>
  );
}
