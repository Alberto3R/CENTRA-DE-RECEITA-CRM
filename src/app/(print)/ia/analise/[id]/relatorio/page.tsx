"use client";

/**
 * Relatório imprimível da análise de conversa/ligação.
 *
 * Existe para ser EXPORTADO EM PDF e mandado ao SDR/vendedor ler e ajustar.
 * A ordem é diferente da tela: o que ele tem que ajustar vem primeiro, e as
 * dimensões depois — ninguém corrige comportamento lendo um score.
 *
 * Mora no grupo (print), FORA de (dashboard), por dois motivos concretos:
 *   1. o layout do dashboard é `h-screen` com rolagem interna — ao imprimir,
 *      só a primeira viewport saía, e o PDF vinha com UMA página;
 *   2. o menu do app aparecia no topo do documento.
 * A URL não muda: route group não entra no caminho.
 *
 * Tela e papel são modos diferentes de propósito: escuro e com corpo maior
 * na tela (é lido no monitor antes de virar PDF), papel só na impressão.
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

const VEREDITO: Record<string, string> = {
  A: "Conversa bem conduzida. Os ajustes abaixo são de refino.",
  B: "Conversa mediana. Tem dinheiro sendo deixado na mesa nos pontos abaixo.",
  C: "Conversa perdeu o controle. Comece pelos dois primeiros ajustes.",
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
  abertura_rapport: "Abertura e rapport",
  qualificacao_fit: "Qualificação e fit",
  spin: "SPIN — perguntas",
  apresentacao: "Apresentação",
  objecoes: "Objeções",
  preco: "Preço",
  fechamento_proximos_passos: "Fechamento e próximos passos",
  fechamento: "Fechamento",
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

/** Mesma régua de cor do CRM: >=8 verde · >=5 âmbar · <5 vermelho. */
function tomDoScore(score: number): "bom" | "medio" | "ruim" {
  if (score >= 8) return "bom";
  if (score >= 5) return "medio";
  return "ruim";
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

const CSS = `
.rel {
  --papel:#12120F; --tinta:#EFEDE4; --fraco:#9E9789; --caixa:#1A1A17;
  --linha:#2E2E29; --linha2:#3D3D36;
  --bom:#34d399; --medio:#fbbf24; --ruim:#f87171;
  --verde:#A6E43C;
  background:var(--papel); color:var(--tinta);
  font-family:var(--font-sans,system-ui),sans-serif;
  line-height:1.55; padding:32px 24px 64px;
}
.rel .folha{max-width:820px;margin:0 auto}
.rel .mono{font-family:var(--font-jetbrains-mono,ui-monospace),monospace}
.rel .fraco{color:var(--fraco)}

.rel .cab{border-bottom:2px solid var(--linha2);padding-bottom:18px;margin-bottom:26px}
.rel .cab .kicker{font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin:0}
.rel .cab h1{font-size:34px;font-weight:700;line-height:1.05;letter-spacing:-.02em;margin:10px 0 0}
.rel .cab .sub{font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:8px 0 0}

.rel .topo{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:22px}
.rel .box{border:1px solid var(--linha2);border-radius:6px;padding:14px 18px;background:var(--caixa)}
.rel .box .rot{font-size:10px;letter-spacing:.18em;text-transform:uppercase;margin:0;color:var(--fraco)}
.rel .nota{min-width:118px}
.rel .nota .v{font-size:44px;font-weight:700;line-height:1;margin:4px 0 0}
.rel .nota.bom .v{color:var(--bom)} .rel .nota.medio .v{color:var(--medio)} .rel .nota.ruim .v{color:var(--ruim)}
.rel .perda{flex:1;min-width:210px}
.rel .perda .v{font-size:27px;font-weight:700;line-height:1.15;margin:4px 0 0}
.rel .perda .memo{font-size:13px;line-height:1.45;margin:6px 0 0;color:var(--fraco)}

.rel .leitura{border-left:4px solid var(--verde);padding:2px 0 2px 14px;font-size:17px;
  line-height:1.45;margin:0 0 34px;font-weight:500}

.rel h2{font-size:12px;letter-spacing:.2em;text-transform:uppercase;font-weight:500;
  border-bottom:1px solid var(--linha2);padding-bottom:6px;margin:0 0 14px;color:var(--fraco)}
.rel section{margin-bottom:34px}
.rel .grid{display:grid;gap:14px}
.rel .card{border:1px solid var(--linha);border-radius:6px;padding:14px 16px;background:var(--caixa)}

.rel .oque{font-size:16px;font-weight:600;line-height:1.4;margin:6px 0 0}
.rel .script{border-left:3px solid var(--verde);padding:8px 0 8px 14px;font-size:15px;
  line-height:1.5;margin:10px 0 0;font-style:italic}

.rel .passos{display:grid;gap:9px;font-size:16px;line-height:1.45;margin:0;padding:0;list-style:none}
.rel .passos li{display:flex;gap:10px}
.rel .passos .n{font-size:12px;color:var(--fraco);padding-top:3px}

.rel .dimtopo{display:flex;justify-content:space-between;align-items:baseline;gap:14px}
.rel .dimtopo h3{font-size:17px;font-weight:600;margin:0;line-height:1.25}
.rel .score{font-size:15px;font-weight:700}
.rel .score.bom{color:var(--bom)} .rel .score.medio{color:var(--medio)} .rel .score.ruim{color:var(--ruim)}
.rel .barra{height:7px;background:var(--linha);border-radius:99px;overflow:hidden;margin:8px 0 0}
.rel .barra i{display:block;height:100%;border-radius:99px}
.rel .barra i.bom{background:var(--bom)} .rel .barra i.medio{background:var(--medio)} .rel .barra i.ruim{background:var(--ruim)}
.rel .resumo{font-size:15px;line-height:1.5;margin:10px 0 0}
.rel .evs{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:11px}
.rel .ev{border-left:2px solid var(--linha2);padding-left:13px}
.rel .ev .ts{font-size:11px;color:var(--fraco);margin:0}
.rel .ev .trecho{font-size:14.5px;font-style:italic;line-height:1.45;margin:2px 0 0}
.rel .ev .coment{font-size:14.5px;line-height:1.45;margin:4px 0 0;color:var(--fraco)}

.rel .faltantes{border:1px dashed var(--linha2);border-radius:6px;padding:14px 16px}
.rel .faltantes ul{margin:6px 0 0;padding:0;list-style:none;font-size:14.5px;line-height:1.6;color:var(--fraco)}
.rel footer{border-top:1px solid var(--linha);padding-top:14px;margin-top:36px;
  font-size:10px;letter-spacing:.14em;text-transform:uppercase;line-height:1.9;color:var(--fraco)}

/* ---------------- PAPEL ---------------- */
@page{size:A4;margin:14mm 12mm}
@media print{
  .nao-imprimir{display:none!important}
  .rel{
    --papel:#fff; --tinta:#101010; --fraco:#4A463D; --caixa:#fff;
    --linha:#d4d4d0; --linha2:#101010;
    --bom:#1a7f5a; --medio:#a9700a; --ruim:#c0392b;
    padding:0; line-height:1.4;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  .rel .folha{max-width:none}
  .rel .cab h1{font-size:26px}
  .rel .leitura{font-size:14px;margin-bottom:22px}
  .rel .oque{font-size:13.5px}
  .rel .script{font-size:12.5px}
  .rel .passos{font-size:13.5px}
  .rel .dimtopo h3{font-size:14.5px}
  .rel .resumo{font-size:12.5px}
  .rel .ev .trecho,.rel .ev .coment{font-size:12px}
  .rel .faltantes ul{font-size:12px}
  .rel .box{background:#F4F2EC}
  .rel .card{border-color:#d4d4d0}
  .qe{break-inside:avoid;page-break-inside:avoid}
  .qa{break-before:page;page-break-before:always}
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
  const tomNota = a.nota === "A" ? "bom" : a.nota === "B" ? "medio" : "ruim";

  return (
    <>
      <style>{CSS}</style>

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

      <div className="rel">
        <div className="folha">
          <header className="cab qe">
            <p className="kicker mono fraco">Sales 3R · Análise de conversa</p>
            <h1>{vendedor?.nome ?? "Relatório da conversa"}</h1>
            <p className="sub mono fraco">
              {vendedor?.funcao
                ? `${FUNCAO_ROTULO[vendedor.funcao] ?? vendedor.funcao} · `
                : ""}
              {dataLonga(detalhe.created_at)}
              {detalhe.tipo ? ` · ${detalhe.tipo}` : ""}
            </p>
          </header>

          <section className="topo qe">
            <div className={`box nota ${tomNota}`}>
              <p className="rot mono">Nota</p>
              <p className="v">{a.nota}</p>
            </div>
            {perda && (
              <div className="box perda">
                <p className="rot mono">Estimativa de perda nesta conversa</p>
                <p className="v">{perda}</p>
                {a.perda_memoria_calculo && (
                  <p className="memo">{a.perda_memoria_calculo}</p>
                )}
              </div>
            )}
          </section>

          <p className="leitura">{VEREDITO[a.nota] ?? VEREDITO.B}</p>

          {a.prescricoes.length > 0 && (
            <section>
              <h2 className="mono">O que fazer diferente na próxima</h2>
              <div className="grid">
                {a.prescricoes.map((p, i) => (
                  <div key={i} className="card qe">
                    <p className="rot mono fraco" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", margin: 0 }}>
                      {rotularDimensao(p.dimensao)}
                    </p>
                    <p className="oque">{p.o_que_dizer}</p>
                    {p.exemplo_script && (
                      <p className="script">“{p.exemplo_script}”</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {a.proximos_passos.length > 0 && (
            <section className="qe">
              <h2 className="mono">Próximos passos</h2>
              <ol className="passos">
                {a.proximos_passos.map((p, i) => (
                  <li key={i}>
                    <span className="n mono">{String(i + 1).padStart(2, "0")}</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="qa">
            <h2 className="mono">Dimensões avaliadas</h2>
            <p className="fraco" style={{ fontSize: 14, margin: "-6px 0 16px" }}>
              Da mais fraca para a mais forte. As citações são trechos reais da conversa.
            </p>
            <div className="grid">
              {dims.map(([chave, d]) => {
                const score = typeof d?.score === "number" ? d.score : 0;
                const tom = tomDoScore(score);
                const evid = Array.isArray(d?.evidencias) ? d.evidencias : [];
                return (
                  <div key={chave} className="card qe">
                    <div className="dimtopo">
                      <h3>{rotularDimensao(chave)}</h3>
                      <span className={`score mono ${tom}`}>
                        {score}
                        <span className="fraco">/10</span>
                      </span>
                    </div>
                    <div className="barra">
                      <i
                        className={tom}
                        style={{ width: `${Math.max(0, Math.min(10, score)) * 10}%` }}
                      />
                    </div>
                    {d.resumo && <p className="resumo">{d.resumo}</p>}
                    {evid.length > 0 && (
                      <ul className="evs">
                        {evid.map((e, i) => (
                          <li key={i} className="ev">
                            <p className="ts mono">{e.timestamp}</p>
                            {e.trecho && <p className="trecho">“{e.trecho}”</p>}
                            {e.comentario && <p className="coment">{e.comentario}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {a.dados_faltantes.length > 0 && (
            <section className="faltantes qe">
              <h2 className="mono" style={{ border: 0, padding: 0, margin: 0 }}>
                Não deu pra avaliar
              </h2>
              <ul>
                {a.dados_faltantes.map((d, i) => (
                  <li key={i}>· {d}</li>
                ))}
              </ul>
            </section>
          )}

          <footer className="mono">
            Sales 3R Performance Comercial · análise gerada em{" "}
            {dataLonga(detalhe.created_at)}
            <br />
            Documento de treino — para leitura e ajuste do próprio vendedor.
          </footer>
        </div>
      </div>
    </>
  );
}
