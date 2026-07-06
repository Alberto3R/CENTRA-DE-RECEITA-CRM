// Motor ANALISA — PAUTA DO FUNIL. Função pura: recebe o cálculo já feito
// (forecast.ts) e a IA só interpreta. NÃO acessa banco. Portado do head comercIAl.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  getAnthropic,
  MODELO_ANALISE,
  systemCacheado,
  toolsCacheadas,
  type UsoTokens,
} from "./anthropic";
import {
  PROMPT_VERSAO,
  PAUTA_TOOL,
  SYSTEM_PROMPT,
  SINAIS_FORECAST,
} from "./prompts/pauta-funil-v1";
import type { CalculoFunil } from "./pauta-funil/forecast";

const blocoPautaSchema = z.object({
  titulo: z.string().min(1),
  ponto: z.string(),
});

const dealRiscoSchema = z.object({
  deal: z.string().min(1),
  o_que_fazer: z.string(),
});

export const interpretacaoPautaSchema = z.object({
  sinal_forecast: z.enum(SINAIS_FORECAST),
  leitura_forecast: z.string(),
  pauta_reuniao: z.array(blocoPautaSchema),
  deals_em_risco: z.array(dealRiscoSchema),
  gargalo_leitura: z.string(),
  dados_faltantes: z.array(z.string()),
});

export type InterpretacaoPauta = z.infer<typeof interpretacaoPautaSchema>;

export interface ResultadoPauta {
  interpretacao: InterpretacaoPauta;
  uso: UsoTokens;
  promptVersao: typeof PROMPT_VERSAO;
}

export async function interpretarPauta(input: {
  calculo: CalculoFunil;
}): Promise<ResultadoPauta> {
  const { calculo } = input;
  if (calculo.deals.length === 0) {
    throw new Error("Sem deals abertos para interpretar.");
  }

  const client = getAnthropic();
  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 8000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([PAUTA_TOOL]),
    tool_choice: { type: "tool", name: PAUTA_TOOL.name },
    messages: [{ role: "user", content: montarPrompt(calculo) }],
  });

  const toolInput = extrairToolInput(resposta, PAUTA_TOOL.name);
  const interpretacao = interpretacaoPautaSchema.parse(toolInput);

  return {
    interpretacao,
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}

function montarPrompt(c: CalculoFunil): string {
  const r = c.resumo;
  const fmtR$ = (v: number | null) =>
    v === null ? "não informado" : `R$ ${v.toLocaleString("pt-BR")}`;
  const fmtNum = (v: number | null) => (v === null ? "não informado" : String(v));
  const fmtPct = (v: number | null) =>
    v === null ? "não informado" : `${(v * 100).toFixed(1)}%`;

  const numeros = {
    meta: fmtR$(r.meta),
    pipeline: fmtR$(r.pipeline),
    forecast: fmtR$(r.forecast),
    gap_meta_menos_forecast: fmtR$(r.gap),
    pipeline_descoberto: fmtR$(r.pipelineDescoberto),
    cobertura_pipe_descoberto_sobre_gap:
      r.cobertura === null ? "n/a (sem gap ou meta já coberta)" : `${r.cobertura.toFixed(2)}x`,
    variancia_forecast_menos_meta: fmtR$(r.variancia),
    variancia_pct: fmtPct(r.varianciaPct),
    total_deals: r.totalDeals,
    deals_sem_valor: r.dealsSemValor,
    deals_em_risco: r.totalEmRisco,
    valor_preso_em_risco: fmtR$(r.valorEmRisco),
    limiar_dias_parado: r.limiteDiasParado,
    data_referencia_hoje: r.hojeIso,
  };

  const dealsRisco = c.emRisco.map((d) => ({
    deal: d.deal,
    vendedor: d.vendedor ?? "não informado",
    valor: fmtR$(d.valor ?? null),
    etapa: d.etapa ?? "não informado",
    dias_parado: fmtNum(d.diasParado ?? null),
    data_fechamento: d.dataFechamento ?? "não informado",
    motivo_do_risco: d.motivoRisco ?? "",
  }));

  const gargalos = c.gargalos.map((g) => ({
    etapa: g.etapa,
    deals_empilhados: g.quantidade,
    valor_na_etapa: fmtR$(g.valor),
    deals_sem_valor: g.semValor,
  }));

  return [
    "Interprete o funil abaixo e monte a PAUTA da reunião semanal de pipeline. Os NÚMEROS já foram calculados em código — são a verdade. NÃO recalcule, NÃO contradiga a marcação de risco.",
    "",
    "NÚMEROS DO FORECAST (calculados):",
    JSON.stringify(numeros, null, 2),
    "",
    c.etapasForecast.length > 0
      ? `ETAPAS CONSIDERADAS FUNDO DE FUNIL (entraram no forecast): ${c.etapasForecast.join(", ")}.`
      : "NENHUMA etapa foi reconhecida como fundo de funil — o forecast pode estar subestimado; sinalize que falta marcar as etapas comprometidas.",
    "",
    "GARGALO POR ETAPA (onde os deals empilham):",
    JSON.stringify(gargalos, null, 2),
    "",
    dealsRisco.length > 0
      ? "DEALS EM RISCO (marcados POR REGRA — prescreva a próxima ação de cada um):"
      : "DEALS EM RISCO: nenhum deal foi marcado em risco pela regra.",
    dealsRisco.length > 0 ? JSON.stringify(dealsRisco, null, 2) : "",
    "",
    r.meta === null
      ? "ATENÇÃO: a META não foi informada — NÃO invente meta/gap/variância. Leia só pipeline, risco e gargalo, e use sinal_forecast = sem_meta."
      : "Abra a pauta pela VARIÂNCIA vs meta, depois o gargalo, depois os deals em risco prioritários, e feche com o compromisso da semana.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function extrairToolInput(resposta: Anthropic.Message, nomeTool: string): unknown {
  const bloco = resposta.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === nomeTool,
  );
  if (!bloco) {
    throw new Error(
      `O modelo não chamou a tool "${nomeTool}" (stop_reason: ${resposta.stop_reason}). Resposta inesperada do Motor ANALISA.`,
    );
  }
  return bloco.input;
}
