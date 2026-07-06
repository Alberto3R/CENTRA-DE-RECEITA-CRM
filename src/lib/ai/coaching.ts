// Motor DESENVOLVE — RITMO DE COACHING. Função pura: recebe o vendedor + um
// resumo das análises acumuladas dele. NÃO acessa banco. Portado do head comercIAl.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  getAnthropic,
  MODELO_ANALISE,
  systemCacheado,
  toolsCacheadas,
  type UsoTokens,
} from "./anthropic";
import { COACHING_TOOL, DIMENSOES, PROMPT_VERSAO, SYSTEM_PROMPT } from "./prompts/coaching-v1";

const dealCoachingSchema = z.object({
  negocio_ou_trecho: z.string(),
  evidencia: z.string(),
  o_que_fazer_esta_semana: z.string(),
});

const skillCoachingSchema = z.object({
  dimensao_alvo: z.enum(DIMENSOES),
  diagnostico: z.string(),
  exercicio: z.string(),
  roteiro_role_play: z.string(),
});

const pauta1on1Schema = z.object({
  resultado: z.string(),
  rotina: z.string(),
  ritual: z.string(),
});

const combinadoSchema = z.object({
  desafio: z.string(),
  prazo: z.string(),
});

export const cicloCoachingSchema = z.object({
  deal_coaching: dealCoachingSchema,
  skill_coaching: skillCoachingSchema.nullable(),
  pauta_1on1: pauta1on1Schema,
  combinado: combinadoSchema,
  observacao_curva: z.string(),
});

export type CicloCoaching = z.infer<typeof cicloCoachingSchema>;

export interface AnaliseResumida {
  data: string;
  nota?: string | null;
  scores: Partial<Record<(typeof DIMENSOES)[number], number>>;
  prescricoes?: string[];
}

export interface VendedorCoaching {
  nome: string;
  funcao: string;
}

export interface ResultadoCoaching {
  ciclo: CicloCoaching;
  uso: UsoTokens;
  promptVersao: typeof PROMPT_VERSAO;
}

export async function gerarCicloCoaching(input: {
  vendedor: VendedorCoaching;
  analises: AnaliseResumida[];
}): Promise<ResultadoCoaching> {
  const { vendedor, analises } = input;
  if (analises.length === 0) {
    throw new Error(
      "Sem análises para este vendedor: não há base para montar um ciclo de coaching.",
    );
  }

  const client = getAnthropic();
  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 8000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([COACHING_TOOL]),
    tool_choice: { type: "tool", name: COACHING_TOOL.name },
    messages: [{ role: "user", content: montarPrompt(vendedor, analises) }],
  });

  const toolInput = extrairToolInput(resposta, COACHING_TOOL.name);
  const ciclo = cicloCoachingSchema.parse(toolInput);

  return {
    ciclo,
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}

function montarPrompt(vendedor: VendedorCoaching, analises: AnaliseResumida[]): string {
  const ordenadas = [...analises].sort((a, b) => a.data.localeCompare(b.data));
  const coldStart = ordenadas.length < 2;

  const linhas = ordenadas.map((a, i) => {
    const scores = DIMENSOES.map((d) => {
      const v = a.scores[d];
      return `${d}=${v == null ? "—" : v}`;
    }).join(", ");
    const presc =
      a.prescricoes && a.prescricoes.length > 0
        ? `\n     prescrições: ${a.prescricoes.join(" | ")}`
        : "";
    const nota = a.nota ? ` · nota ${a.nota}` : "";
    return `  ${i + 1}. [${a.data}]${nota}\n     scores: ${scores}${presc}`;
  });

  return [
    "Monte o ciclo de coaching da semana do vendedor abaixo, a partir das análises de call acumuladas dele.",
    "",
    `Vendedor: ${vendedor.nome}`,
    `Função: ${vendedor.funcao}`,
    `Total de análises: ${ordenadas.length}`,
    "",
    "Análises (da mais antiga para a mais nova; scores de 0 a 10 por dimensão):",
    ...linhas,
    "",
    coldStart
      ? "COLD START: há apenas 1 análise. Trabalhe SÓ com deal coaching sobre o que existe, deixe skill_coaching = null e, na observacao_curva, diga que a curva de evolução começa a ser lida a partir da 2ª análise/semana. NÃO invente tendência nem histórico."
      : "Use a evolução dos scores ao longo das análises para a curva e para identificar a dimensão com pior nota RECORRENTE (skill coaching). Não invente número que não esteja acima.",
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
