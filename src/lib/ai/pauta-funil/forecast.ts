// PAUTA DO FUNIL — CÁLCULO DETERMINÍSTICO. Portado do head comercIAl.
// Dado os deals + a meta, computa EM CÓDIGO pipeline/forecast/gap/cobertura/
// variância, deals em risco e gargalo por etapa. A IA só interpreta — nunca recalcula.

/** Um deal do funil, no formato que o cálculo consome (vem do agregador do CRM). */
export interface DealFunil {
  deal: string;
  vendedor?: string | null;
  /** valor em R$. undefined = sem valor (NÃO é 0). */
  valor?: number;
  etapa?: string;
  /** dias parado na etapa (proxy: dias desde a última atualização). */
  diasParado?: number;
  /** data prevista de fechamento, ISO YYYY-MM-DD. */
  dataFechamento?: string;
}

export type MotivoRisco = "estagnado" | "vencido" | "valor_atipico";

export interface DealCalculado extends DealFunil {
  emRisco: boolean;
  motivos: MotivoRisco[];
  motivoRisco: string | null;
  noForecast: boolean;
}

export interface Gargalo {
  etapa: string;
  quantidade: number;
  valor: number;
  semValor: number;
}

export interface ResumoForecast {
  meta: number | null;
  pipeline: number;
  forecast: number;
  gap: number | null;
  pipelineDescoberto: number;
  cobertura: number | null;
  variancia: number | null;
  varianciaPct: number | null;
  totalDeals: number;
  dealsSemValor: number;
  totalEmRisco: number;
  valorEmRisco: number;
  limiteDiasParado: number;
  hojeIso: string;
}

export interface CalculoFunil {
  resumo: ResumoForecast;
  deals: DealCalculado[];
  emRisco: DealCalculado[];
  gargalos: Gargalo[];
  etapasForecast: string[];
}

export interface ParametrosForecast {
  limiteDiasParado?: number;
  hojeIso?: string;
  fatorOutlierValor?: number;
}

function normalizarEtapa(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const TERMOS_FORECAST = [
  "negociacao", "negociação", "proposta", "fechamento", "fechando", "contrato",
  "assinatura", "won", "ganho", "ganhos", "fechado", "fechados", "decisao",
  "decisão", "comprometid", "commit", "aprovacao", "aprovação", "final",
];

function ehEtapaForecast(etapaNorm: string): boolean {
  return TERMOS_FORECAST.some((t) => etapaNorm.includes(normalizarEtapa(t)));
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 === 0 ? (ord[meio - 1]! + ord[meio]!) / 2 : ord[meio]!;
}

function descreverMotivos(
  motivos: MotivoRisco[],
  d: DealFunil,
  hojeIso: string,
  limiteDias: number,
): string | null {
  if (motivos.length === 0) return null;
  const partes: string[] = [];
  for (const m of motivos) {
    if (m === "estagnado") {
      partes.push(
        d.diasParado !== undefined
          ? `parado ${d.diasParado} dias na etapa (> ${limiteDias})`
          : `parado além de ${limiteDias} dias`,
      );
    } else if (m === "vencido") {
      partes.push(
        d.dataFechamento
          ? `fechamento previsto em ${d.dataFechamento} já venceu (hoje ${hojeIso})`
          : "fechamento previsto vencido",
      );
    } else if (m === "valor_atipico") {
      partes.push("valor muito acima do padrão (concentra risco)");
    }
  }
  return partes.join("; ");
}

export function calcularForecast(
  deals: DealFunil[],
  meta: number | null,
  params: ParametrosForecast = {},
): CalculoFunil {
  const limiteDiasParado = params.limiteDiasParado ?? 14;
  const fatorOutlier = params.fatorOutlierValor ?? 3;
  const hojeIso = params.hojeIso ?? new Date().toISOString().slice(0, 10);

  const valores = deals
    .map((d) => d.valor)
    .filter((v): v is number => typeof v === "number");
  const medianaValor = mediana(valores);
  const corteOutlier =
    medianaValor !== null && valores.length >= 4 ? medianaValor * fatorOutlier : null;

  let pipeline = 0;
  let forecast = 0;
  let dealsSemValor = 0;
  const etapasForecastSet = new Set<string>();

  const calculados: DealCalculado[] = deals.map((d) => {
    const temValor = typeof d.valor === "number";
    if (!temValor) dealsSemValor += 1;
    if (temValor) pipeline += d.valor!;

    const etapaNorm = d.etapa ? normalizarEtapa(d.etapa) : "";
    const noForecast = etapaNorm !== "" && ehEtapaForecast(etapaNorm) && temValor;
    if (noForecast) {
      forecast += d.valor!;
      if (d.etapa) etapasForecastSet.add(d.etapa);
    }

    const motivos: MotivoRisco[] = [];
    if (d.diasParado !== undefined && d.diasParado > limiteDiasParado) {
      motivos.push("estagnado");
    }
    if (d.dataFechamento !== undefined && d.dataFechamento < hojeIso) {
      motivos.push("vencido");
    }
    if (corteOutlier !== null && temValor && d.valor! > corteOutlier) {
      motivos.push("valor_atipico");
    }

    const emRisco = motivos.length > 0;
    return {
      ...d,
      emRisco,
      motivos,
      motivoRisco: descreverMotivos(motivos, d, hojeIso, limiteDiasParado),
      noForecast,
    };
  });

  const gap = meta !== null ? meta - forecast : null;
  const pipelineDescoberto = Math.max(0, pipeline - forecast);
  let cobertura: number | null = null;
  if (gap !== null && gap > 0) {
    cobertura = pipelineDescoberto / gap;
  }
  const variancia = meta !== null ? forecast - meta : null;
  const varianciaPct = meta !== null && meta !== 0 ? forecast / meta - 1 : null;

  const emRiscoLista = calculados
    .filter((d) => d.emRisco)
    .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
  const valorEmRisco = emRiscoLista.reduce((acc, d) => acc + (d.valor ?? 0), 0);

  const porEtapa = new Map<string, Gargalo>();
  for (const d of calculados) {
    const chave = d.etapa && d.etapa.trim() !== "" ? d.etapa.trim() : "(sem etapa)";
    const atual = porEtapa.get(chave) ?? {
      etapa: chave,
      quantidade: 0,
      valor: 0,
      semValor: 0,
    };
    atual.quantidade += 1;
    if (typeof d.valor === "number") atual.valor += d.valor;
    else atual.semValor += 1;
    porEtapa.set(chave, atual);
  }
  const gargalos = [...porEtapa.values()].sort(
    (a, b) => b.quantidade - a.quantidade || b.valor - a.valor,
  );

  const resumo: ResumoForecast = {
    meta,
    pipeline,
    forecast,
    gap,
    pipelineDescoberto,
    cobertura,
    variancia,
    varianciaPct,
    totalDeals: deals.length,
    dealsSemValor,
    totalEmRisco: emRiscoLista.length,
    valorEmRisco,
    limiteDiasParado,
    hojeIso,
  };

  return {
    resumo,
    deals: calculados,
    emRisco: emRiscoLista,
    gargalos,
    etapasForecast: [...etapasForecastSet],
  };
}
