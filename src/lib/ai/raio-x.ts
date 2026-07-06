// Motor ANALISA — RAIO-X DE FUNIL. Função pura: recebe as métricas já calculadas
// (matriz.ts) e a IA só interpreta. NÃO acessa banco. Portado do head comercIAl.

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
  RAIOX_TOOL,
  SYSTEM_PROMPT,
  TIPOS_COACHING,
} from "./prompts/raio-x-v1";
import type { ResumoMatriz } from "./raio-x/matriz";

const porVendedorSchema = z.object({
  nome: z.string().min(1),
  leitura: z.string(),
  prescricao_tipo_coaching: z.enum(TIPOS_COACHING),
  prescricao_acao: z.string(),
});

export const interpretacaoRaioXSchema = z.object({
  por_vendedor: z.array(porVendedorSchema),
  gargalo_time: z.string(),
  recomendacao_geral: z.string(),
  dados_faltantes: z.array(z.string()),
});

export type InterpretacaoRaioX = z.infer<typeof interpretacaoRaioXSchema>;

export interface ResultadoRaioX {
  interpretacao: InterpretacaoRaioX;
  uso: UsoTokens;
  promptVersao: typeof PROMPT_VERSAO;
}

export async function interpretarRaioX(input: {
  metricas: ResumoMatriz;
}): Promise<ResultadoRaioX> {
  const { metricas } = input;
  if (metricas.vendedores.length === 0) {
    throw new Error("Sem vendedores para interpretar.");
  }

  const client = getAnthropic();
  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 8000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([RAIOX_TOOL]),
    tool_choice: { type: "tool", name: RAIOX_TOOL.name },
    messages: [{ role: "user", content: montarPrompt(metricas) }],
  });

  const toolInput = extrairToolInput(resposta, RAIOX_TOOL.name);
  const interpretacao = interpretacaoRaioXSchema.parse(toolInput);

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

function montarPrompt(m: ResumoMatriz): string {
  const fmtEfic = (v: number | null) =>
    v === null ? "não informado" : `${(v * 100).toFixed(1)}%`;
  const fmtNum = (v: number | null) => (v === null ? "não informado" : String(v));

  const linhas = m.vendedores.map((v) => ({
    nome: v.nome,
    quadrante: v.quadrante ?? "INCOMPLETO (dado faltando — não classificar)",
    atividade: fmtNum(v.atividade),
    eficiencia: fmtEfic(v.eficiencia),
    ciclo_dias: fmtNum(v.ciclo),
    ticket: fmtNum(v.ticket),
  }));

  const cortes = {
    corte_atividade_mediana: fmtNum(m.cortes.atividade),
    corte_eficiencia_mediana: fmtEfic(m.cortes.eficiencia),
  };

  return [
    "Interprete o raio-x do time abaixo. Os NÚMEROS e os QUADRANTES já foram calculados em código — são a verdade. NÃO recalcule, NÃO contradiga o quadrante.",
    "",
    "CORTES DO TIME (mediana, eixo da matriz):",
    JSON.stringify(cortes, null, 2),
    "",
    "VENDEDORES (com quadrante já atribuído):",
    JSON.stringify(linhas, null, 2),
    "",
    "CONTAGEM POR QUADRANTE:",
    JSON.stringify(m.contagem, null, 2),
    "",
    m.gargalo
      ? `GARGALO AGREGADO (calculado): quadrante "${m.gargalo.quadrante}" concentra ${m.gargalo.quantidade} de ${m.gargalo.total} vendedores classificados.`
      : "GARGALO AGREGADO: não foi possível calcular (sem vendedores classificados).",
    m.vendedorRisco ? `Vendedor mais crítico (quadrante risco): ${m.vendedorRisco}.` : "",
    m.incompletos.length > 0
      ? `INCOMPLETOS (não classificados, dado faltando — NÃO inventar): ${m.incompletos.join(", ")}.`
      : "",
    "",
    "Para CADA vendedor classificado, devolva leitura + tipo de coaching coerente com o quadrante. Liste os incompletos em dados_faltantes (o que coletar). Depois, o gargalo do time e a recomendação geral.",
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
