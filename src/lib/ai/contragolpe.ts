// CONTRAGOLPE (Motor CRIA). Função pura: recebe a objeção colada, contexto
// opcional e o tom da empresa (account_sales_config), chama o Anthropic com
// tool_choice forçado, valida com zod e devolve { contragolpe, uso }.
// NÃO acessa banco — quem persiste é o caller. Portado do head comercIAl.

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
  CONTRAGOLPE_TOOL,
  PROMPT_VERSAO,
  SYSTEM_PROMPT,
  TIPOS_OBJECAO,
} from "./prompts/contragolpe-v1";

const contornoSchema = z.object({
  abordagem: z.string().min(1),
  o_que_dizer: z.string().min(1),
  exemplo_script: z.string().min(1),
  logica: z.string().min(1),
});

export const contragolpeSchema = z.object({
  objecao_resumida: z.string().min(1),
  tipo_objecao: z.enum(TIPOS_OBJECAO),
  contornos: z.array(contornoSchema).min(2).max(3),
  pergunta_de_isolamento: z.string().min(1),
});

export type Contragolpe = z.infer<typeof contragolpeSchema>;

/** Tom/identidade do cliente, de account_sales_config (formato livre). */
export type TomEmpresa = Record<string, unknown> | string | null | undefined;

export interface ResultadoContragolpe {
  contragolpe: Contragolpe;
  uso: UsoTokens;
  promptVersao: typeof PROMPT_VERSAO;
}

export async function gerarContragolpe(args: {
  objecao: string;
  contexto?: string;
  tom?: TomEmpresa;
}): Promise<ResultadoContragolpe> {
  const objecao = args.objecao.trim();
  if (objecao === "") {
    throw new Error("Objeção vazia: não há o que contornar.");
  }

  const client = getAnthropic();

  const partes: string[] = [`OBJEÇÃO DO CLIENTE (texto literal):\n${objecao}`];
  if (args.contexto && args.contexto.trim() !== "") {
    partes.push(`CONTEXTO ADICIONAL:\n${args.contexto.trim()}`);
  }
  const tom = formatarTom(args.tom);
  if (tom) {
    partes.push(`TOM/IDENTIDADE DA EMPRESA (use este tom nos scripts):\n${tom}`);
  } else {
    partes.push(
      "TOM/IDENTIDADE DA EMPRESA: não informado. Use um tom consultivo, direto e respeitoso.",
    );
  }
  partes.push(
    "Gere 2 a 3 contornos no tom da empresa e a pergunta que isola a objeção real. Lembre: nunca brigue com a objeção, nunca invente número.",
  );

  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 4000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([CONTRAGOLPE_TOOL]),
    tool_choice: { type: "tool", name: CONTRAGOLPE_TOOL.name },
    messages: [{ role: "user", content: partes.join("\n\n") }],
  });

  const toolInput = extrairToolInput(resposta, CONTRAGOLPE_TOOL.name);
  const contragolpe = contragolpeSchema.parse(toolInput);

  return {
    contragolpe,
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}

function formatarTom(tom: TomEmpresa): string | null {
  if (!tom) return null;
  if (typeof tom === "string") return tom.trim() || null;
  if (typeof tom !== "object") return null;
  const entradas = Object.entries(tom).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entradas.length === 0) return null;
  return entradas
    .map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}

function extrairToolInput(resposta: Anthropic.Message, nomeTool: string): unknown {
  const bloco = resposta.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === nomeTool,
  );
  if (!bloco) {
    throw new Error(
      `O modelo não chamou a tool "${nomeTool}" (stop_reason: ${resposta.stop_reason}). Resposta inesperada do Contragolpe.`,
    );
  }
  return bloco.input;
}
