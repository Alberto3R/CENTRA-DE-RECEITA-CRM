// Motor DESENVOLVE — PARECER + PDI de 90 dias. Função pura. NÃO acessa banco.
// Portado do head comercIAl.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  getAnthropic,
  MODELO_ANALISE,
  systemCacheado,
  toolsCacheadas,
  type UsoTokens,
} from "./anthropic";
import { BANDEIRAS, PDI_TOOL, PROMPT_VERSAO, SYSTEM_PROMPT } from "./prompts/pdi-v1";

const parecerSchema = z.object({
  bandeira: z.enum(BANDEIRAS),
  leitura: z.string(),
  pros: z.array(z.string()),
  contras: z.array(z.string()),
  dados_faltantes: z.array(z.string()),
});

const metaSchema = z.object({
  meta: z.string(),
  prazo_dias: z.number().int().min(1).max(90),
  como_medir: z.string(),
});

const plano90dSchema = z.object({
  objetivo: z.string(),
  metas: z.array(metaSchema),
  trilha_academy: z.array(z.string()),
  checkpoints: z.array(z.string()),
  criterio_de_saida: z.string(),
});

export const pdiSchema = z.object({
  parecer: parecerSchema,
  plano_90d: plano90dSchema,
  recomendacao: z.string(),
});

export type Pdi = z.infer<typeof pdiSchema>;

export interface VendedorPdi {
  nome: string;
  funcao: string;
  disc?: unknown;
  spin?: unknown;
}

export interface ResultadoPdi {
  pdi: Pdi;
  uso: UsoTokens;
  promptVersao: typeof PROMPT_VERSAO;
}

export async function gerarPDI(input: {
  vendedor: VendedorPdi;
  observacoes?: string;
}): Promise<ResultadoPdi> {
  const { vendedor, observacoes } = input;
  const client = getAnthropic();

  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 8000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([PDI_TOOL]),
    tool_choice: { type: "tool", name: PDI_TOOL.name },
    messages: [{ role: "user", content: montarPrompt(vendedor, observacoes) }],
  });

  const toolInput = extrairToolInput(resposta, PDI_TOOL.name);
  const pdi = pdiSchema.parse(toolInput);

  return {
    pdi,
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}

function montarPrompt(vendedor: VendedorPdi, observacoes?: string): string {
  const disc = vendedor.disc != null ? JSON.stringify(vendedor.disc) : "não informado";
  const spin = vendedor.spin != null ? JSON.stringify(vendedor.spin) : "não informado";
  const obs =
    observacoes && observacoes.trim() !== ""
      ? observacoes.trim()
      : "nenhuma observação informada pelo gestor";

  return [
    "Monte o parecer e o PDI de 90 dias do vendedor abaixo.",
    "",
    `Nome: ${vendedor.nome}`,
    `Função: ${vendedor.funcao}`,
    `Perfil DISC: ${disc}`,
    `Nível SPIN: ${spin}`,
    "",
    "Observações do gestor:",
    obs,
    "",
    "Se DISC, SPIN ou histórico não foram informados, registre em dados_faltantes e ajuste o plano para coletar esse dado primeiro — não invente.",
  ].join("\n");
}

function extrairToolInput(resposta: Anthropic.Message, nomeTool: string): unknown {
  const bloco = resposta.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === nomeTool,
  );
  if (!bloco) {
    throw new Error(
      `O modelo não chamou a tool "${nomeTool}" (stop_reason: ${resposta.stop_reason}). Resposta inesperada do Motor DESENVOLVE.`,
    );
  }
  return bloco.input;
}
