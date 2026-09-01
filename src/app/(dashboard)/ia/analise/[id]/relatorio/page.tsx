"use client";

/**
 * Relatório imprimível da análise de conversa/ligação.
 *
 * Existe para ser EXPORTADO EM PDF e mandado ao SDR/vendedor — por isso a
 * ordem é diferente da tela: o que ele tem que ajustar vem primeiro, e a
 * nota/score depois. Ninguém corrige comportamento lendo um score.
 *
 * PDF sai pelo próprio navegador (`window.print()` → "Salvar como PDF").
 * O projeto não tem — e não precisa de — biblioteca de PDF: geração no
 * navegador é o mesmo caminho já usado no PDF do Diagnóstico, sai em
 * vetor (texto selecionável) e não pesa no serverless.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Printer } from "lucide-react";

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
interface Detalhe {
  id: string;
  created_at: string;
  tipo: string | null;
  seller_id: string | null;
  analise: Analise;
}
interface Seller {
  id: string;
  nome: string;
  funcao: string;
}

const VEREDITO: Record<string, { rotulo: string; leitura: string }> = {
  A: { rotulo: "A", leitura: "Conversa bem conduzida. Os ajustes abaixo são de refino." },
  B: { rotulo: "B", leitura: "Conversa mediana. Tem dinheiro sendo deixado na mesa nos pontos abaixo." },
  C: { rotulo: "C", leitura: "Conversa perdeu o controle. Comece pelos dois primeiros ajustes." },
};

const FUNCAO_ROTULO: Record<string, string> = {
  sdr: "SDR · pré-vendas",
  closer: "Closer",
  social_seller: "Social Seller",
  gestor: "Gestor",
};

/**
 * Rótulos com acento das dimensões das duas réguas (closer 3R e SDR).
 * As chaves vêm sem acento do modelo — e "Objecoes"/"Qualificacao fit"
 * num documento que vai pra mão da pessoa fica pobre.
 */
const DIMENSAO_ROTULO: Record<string, string> = {
  // régua closer (3R)
  abertura_rapport: "Abertura e rapport",
  qualificacao_fit: "Qualificação e fit",
  spin: "SPIN — perguntas",
  apresentacao: "Apresentação",
  objecoes: "Objeções",
  preco: "Preço",
  fechamento_proximos_passos: "Fechamento e próximos passos",
  fechamento: "Fechamento",
  // régua SDR (pré-vendas)
  abertura_enquadramento: "Abertura e enquadramento",
  descoberta_dor: "Descoberta da dor",
  geracao_interesse: "Geração de interesse",
  agendamento: "Agendamento",
  compromisso: "Compromisso e anti no-show",
  compromisso_proximos_passos: "Compromisso e próximos passos",
};

function rotularDimensao(chave: string) {
  const conhecido = DIMENSAO_ROTULO[chave];
  if (conhecido) return conhecido;
  const t = chave.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function reais(v: number | null) {
  if (v === null || Number.isNaN(v)) return null;
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function dataLonga(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const CSS_IMPRESSAO = `
  @page { size: A4; margin: 14mm 12mm; }
  @media print {
    .nao-imprimir { display: none !important; }
    .folha { max-width: none !important; padding: 0 !important; }
    .quebra-evitar { break-inside: avoid; page-break-inside: avoid; }
    .quebra-antes { break-before: page; page-break-before: always; }
    body { background: #fff !important; }
  }
`;

export default function RelatorioAnalisePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const [rA, rS] = await Promise.all([
        fetch(`/api/ai/analise-call/${params.id}`),
        fetch("/api/ai/sellers").catch(() => null),
      ]);
      if (!rA.ok) {
        setErro("Não encontrei essa análise.");
        setCarregando(false);
        return;
      }
      setDetalhe((await rA.json()) as Detalhe);
      if (rS?.ok) {
        const j = (await rS.json()) as { sellers?: Seller[] } | Seller[];
        setSellers(Array.isArray(j) ? j : (j.sellers ?? []));
      }
    } catch {
      setErro("Erro de rede ao carregar o relatório.");
    }
    setCarregando(false);
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Montando o relatório…
      </div>
    );
  }
  if (erro || !detalhe) {
    return <div className="p-8 text-sm text-muted-foreground">{erro}</div>;
  }

  const a = detalhe.analise;
  const vendedor = sellers.find((s) => s.id === detalhe.seller_id);
  const dims = Object.entries(a.dimensoes).sort((x, y) => x[1].score - y[1].score);
  const perda = reais(a.perda_estimada_reais);
  const veredito = VEREDITO[a.nota] ?? VEREDITO.B;

  return (
    <>
      <style>{CSS_IMPRESSAO}</style>

      <div className="nao-imprimir sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Voltar
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          <Printer className="size-4" />
          Salvar em PDF
        </button>
      </div>

      <div className="folha mx-auto max-w-3xl bg-white p-6 text-[#101010] print:text-black">
        {/* ---------- cabeçalho ---------- */}
        <header className="quebra-evitar mb-6 border-b-2 border-[#101010] pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#6E6A60]">
            Sales 3R · Análise de conversa
          </p>
          <h1 className="mt-2 text-3xl font-bold leading-none tracking-tight">
            {vendedor?.nome ?? "Relatório da conversa"}
          </h1>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6E6A60]">
            {vendedor?.funcao ? `${FUNCAO_ROTULO[vendedor.funcao] ?? vendedor.funcao} · ` : ""}
            {dataLonga(detalhe.created_at)}
            {detalhe.tipo ? ` · ${detalhe.tipo}` : ""}
          </p>
        </header>

        {/* ---------- veredito ---------- */}
        <section className="quebra-evitar mb-6 flex flex-wrap items-stretch gap-3">
          <div className="min-w-[110px] rounded border border-[#101010] px-4 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#6E6A60]">
              Nota
            </p>
            <p className="text-4xl font-bold leading-none">{veredito.rotulo}</p>
          </div>
          {perda && (
            <div className="min-w-[160px] flex-1 rounded border border-[#101010] bg-[#F4F2EC] px-4 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#6E6A60]">
                Estimativa de perda nesta conversa
              </p>
              <p className="text-2xl font-bold leading-tight">{perda}</p>
              {a.perda_memoria_calculo && (
                <p className="mt-1 text-[11px] leading-snug text-[#4a4a4a]">
                  {a.perda_memoria_calculo}
                </p>
              )}
            </div>
          )}
        </section>
        <p className="mb-8 border-l-4 border-[#A6E43C] pl-3 text-[15px] leading-snug">
          {veredito.leitura}
        </p>

        {/* ---------- o que ajustar (vem primeiro de propósito) ---------- */}
        {a.prescricoes.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 border-b border-[#ccc] pb-1 font-mono text-[11px] uppercase tracking-[0.2em]">
              O que fazer diferente na próxima
            </h2>
            <div className="grid gap-3">
              {a.prescricoes.map((p, i) => (
                <div key={i} className="quebra-evitar rounded border border-[#ddd] p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#6E6A60]">
                    {rotularDimensao(p.dimensao)}
                  </p>
                  <p className="mt-1 text-[14px] font-semibold leading-snug">{p.o_que_dizer}</p>
                  {p.exemplo_script && (
                    <p className="mt-2 border-l-2 border-[#A6E43C] bg-[#F7F9F0] py-1.5 pl-3 text-[13px] italic leading-snug">
                      “{p.exemplo_script}”
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---------- próximos passos ---------- */}
        {a.proximos_passos.length > 0 && (
          <section className="quebra-evitar mb-8">
            <h2 className="mb-3 border-b border-[#ccc] pb-1 font-mono text-[11px] uppercase tracking-[0.2em]">
              Próximos passos
            </h2>
            <ol className="grid gap-1.5 text-[14px] leading-snug">
              {a.proximos_passos.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-[11px] text-[#6E6A60]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ---------- dimensões, da pior pra melhor ---------- */}
        <section className="quebra-antes">
          <h2 className="mb-1 border-b border-[#ccc] pb-1 font-mono text-[11px] uppercase tracking-[0.2em]">
            Dimensões avaliadas
          </h2>
          <p className="mb-4 text-[12px] text-[#6E6A60]">
            Da mais fraca para a mais forte. As citações são trechos reais da conversa.
          </p>
          <div className="grid gap-4">
            {dims.map(([chave, d]) => (
              <div key={chave} className="quebra-evitar rounded border border-[#ddd] p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-semibold leading-tight">
                    {rotularDimensao(chave)}
                  </h3>
                  <span className="shrink-0 font-mono text-[13px] font-semibold">
                    {d.score}
                    <span className="text-[#6E6A60]">/10</span>
                  </span>
                </div>
                {/* barra: cinza no papel, verde só no preenchimento */}
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e6e6e6] print:border print:border-[#ccc]">
                  <div
                    className="h-full rounded-full bg-[#A6E43C]"
                    style={{ width: `${Math.max(0, Math.min(10, d.score)) * 10}%` }}
                  />
                </div>
                {d.resumo && (
                  <p className="mt-2 text-[13.5px] leading-snug">{d.resumo}</p>
                )}
                {d.evidencias?.length > 0 && (
                  <ul className="mt-2 grid gap-2">
                    {d.evidencias.map((e, i) => (
                      <li key={i} className="border-l-2 border-[#ddd] pl-3">
                        <p className="font-mono text-[10px] text-[#6E6A60]">{e.timestamp}</p>
                        {e.trecho && (
                          <p className="text-[12.5px] italic leading-snug">“{e.trecho}”</p>
                        )}
                        {e.comentario && (
                          <p className="mt-0.5 text-[12.5px] leading-snug text-[#3a3a3a]">
                            {e.comentario}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ---------- o que não deu pra avaliar ---------- */}
        {a.dados_faltantes.length > 0 && (
          <section className="quebra-evitar mt-6 rounded border border-dashed border-[#bbb] p-3">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#6E6A60]">
              Não deu pra avaliar
            </h2>
            <ul className="mt-1 grid gap-1 text-[12.5px] leading-snug text-[#4a4a4a]">
              {a.dados_faltantes.map((d, i) => (
                <li key={i}>· {d}</li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-8 border-t border-[#ccc] pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[#6E6A60]">
          Sales 3R Performance Comercial · análise gerada em {dataLonga(detalhe.created_at)}
          <br />
          Documento de treino — para leitura e ajuste do próprio vendedor.
        </footer>
      </div>
    </>
  );
}
