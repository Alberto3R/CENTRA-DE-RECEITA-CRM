'use client';

/**
 * Relatório de Aquisição — versão para PDF (F5).
 *
 * Existe para ser EXPORTADO e mandado ao dono da empresa/cliente. Mora no
 * grupo (print), fora do layout do dashboard, pelo mesmo motivo do relatório
 * de análise de call: o layout com rolagem interna cortava o PDF na primeira
 * página e o menu do app saía impresso. A URL é /relatorios/aquisicao.
 *
 * Ordem pensada para quem lê sem entrar no CRM: números → o que olhar →
 * canais → campanhas → como foi medido.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { presetRange, type AcquisitionReport } from '@/lib/acquisition/report';
import {
  AcquisitionPdfDocument,
  PDF_CSS,
} from '@/components/relatorios/acquisition-pdf-document';

function Documento() {
  const router = useRouter();
  const sp = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { accountId, account } = useAuth();
  const range = useMemo(() => {
    const from = sp.get('from');
    const to = sp.get('to');
    return from && to ? { from, to } : presetRange('90');
  }, [sp]);
  const [report, setReport] = useState<AcquisitionReport | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!accountId) return;
    const { data, error } = await supabase.rpc('acquisition_report', {
      p_account_id: accountId,
      p_from: range.from,
      p_to: range.to,
    });
    if (error) setErro('Não foi possível montar o relatório.');
    else setReport(data as AcquisitionReport);
  }, [accountId, supabase, range]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga do RPC (padrão do repo)
    void carregar();
  }, [carregar]);

  if (erro)
    return <div className="text-muted-foreground p-8 text-sm">{erro}</div>;
  if (!report) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
        <Loader2 className="size-4 animate-spin" /> Montando o relatório…
      </div>
    );
  }

  return (
    <>
      <style>{PDF_CSS}</style>
      <div className="nao-imprimir border-border bg-background/95 sticky top-0 z-10 flex items-center justify-between gap-2 border-b px-4 py-3 backdrop-blur">
        <button
          onClick={() => router.back()}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="size-4" /> Voltar
        </button>
        <button
          onClick={() => window.print()}
          className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium"
        >
          <Printer className="size-4" /> Salvar em PDF
        </button>
      </div>

      <AcquisitionPdfDocument report={report} accountName={account?.name} />
    </>
  );
}

export default function RelatorioAquisicaoPdfPage() {
  return (
    <Suspense fallback={null}>
      <Documento />
    </Suspense>
  );
}
