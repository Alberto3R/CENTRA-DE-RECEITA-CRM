'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, ChevronDown, FileDown, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { presetRange, type AcquisitionReport } from '@/lib/acquisition/report';
import { LeadAttributionBreakdown } from '@/components/relatorios/lead-attribution-breakdown';
import { AcquisitionReportView } from '@/components/relatorios/acquisition-report-view';

// Relatório de Aquisição (F3): quanto custou cada venda, por canal e por
// campanha, e quanto ela deixou. Venda e receita são SÓ o que o time registrou
// no CRM (negócio ganho + valor); de fora entra apenas o gasto de mídia. O
// cálculo inteiro é o RPC acquisition_report (mig 114); a régua é da conta
// (Configurações → Aquisição).

type Preset = 'month' | 'last_month' | '30' | '90';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'month', label: 'Mês atual' },
  { id: 'last_month', label: 'Mês passado' },
  { id: '30', label: '30 dias' },
  { id: '90', label: '90 dias' },
];

export default function RelatoriosPage() {
  const supabase = useMemo(() => createClient(), []);
  const { accountId, canEditSettings } = useAuth();
  const [preset, setPreset] = useState<Preset>('90');
  const [report, setReport] = useState<AcquisitionReport | null>(null);
  const [hasChannels, setHasChannels] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => presetRange(preset), [preset]);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [rep, ch] = await Promise.all([
      supabase.rpc('acquisition_report', {
        p_account_id: accountId,
        p_from: range.from,
        p_to: range.to,
      }),
      supabase
        .from('acquisition_channels')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
    ]);
    setError(rep.error ? 'Não foi possível montar o relatório.' : null);
    setReport((rep.data as AcquisitionReport) ?? null);
    setHasChannels((ch.count ?? 0) > 0);
    setLoading(false);
  }, [accountId, supabase, range]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga do RPC (padrão do repo)
    load();
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-foreground flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BarChart3 className="text-primary size-6" />
            Relatório de aquisição
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Quanto custou cada venda, por canal, e quanto ela deixou. Venda é o
            negócio marcado como ganho pelo time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/relatorios/aquisicao?from=${range.from}&to=${range.to}`}
            className="border-border bg-card text-foreground hover:border-primary inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium"
          >
            <FileDown className="size-4" /> Exportar PDF
          </Link>
          <div className="border-border bg-card flex flex-wrap gap-1 rounded-lg border p-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  if (p.id === preset) return;
                  setLoading(true);
                  setPreset(p.id);
                }}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  preset === p.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground mt-8 flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : error || !report ? (
        <div className="border-border bg-card text-muted-foreground mt-8 rounded-xl border border-dashed p-8 text-center text-sm">
          {error ?? 'Sem dados.'}
        </div>
      ) : (
        <>
          <AcquisitionReportView
            report={report}
            hasChannels={hasChannels}
            canEditSettings={canEditSettings}
          />

          <details className="group mt-8">
            <summary className="text-foreground flex cursor-pointer list-none items-center gap-1 text-sm font-semibold">
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              Detalhe da atribuição dos leads (campanha, ângulo, origem,
              classificação)
            </summary>
            <div className="mt-3">
              {accountId && (
                <LeadAttributionBreakdown
                  accountId={accountId}
                  from={range.from}
                  to={range.to}
                />
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
