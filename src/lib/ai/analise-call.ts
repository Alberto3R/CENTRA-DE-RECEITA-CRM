// Engine de análise de call. Função pura: recebe transcrição normalizada + a
// MetodoConfig da conta, chama o Anthropic com tool_choice forçado, valida a
// saída com zod (schema montado a partir das dimensões da conta) e devolve
// { analise, uso, promptVersao }. NÃO acessa banco — quem persiste é o caller.
//
// Portado do head comercIAl e generalizado: as dimensões deixam de ser fixas
// (as 7 do 3R) e passam a vir de `config.dimensoes`.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  getAnthropic,
  MODELO_ANALISE,
  systemCacheado,
  toolsCacheadas,
  type UsoTokens,
} from "./anthropic";
import { CONFIG_3R, DIMENSOES_SDR, type MetodoConfig } from "./method-config";
import {
  buildAnaliseTool,
  buildSystemPrompt,
  SYSTEM_PROMPT_SDR,
  PROMPT_VERSAO,
} from "./prompts/analise-call-v1";

/**
 * Objetivo da conversa — define a RÉGUA de análise.
 * - "closer": fechar a venda na conversa (régua 3R padrão).
 * - "sdr": qualificar o lead e agendar a call (régua de pré-vendas).
 */
export type ObjetivoAnalise = "closer" | "sdr";

/** Mapeia a função comercial (closer/sdr/social_seller/gestor) para a régua. */
export function objetivoDeFuncao(
  funcao: string | null | undefined,
): ObjetivoAnalise {
  return funcao === "sdr" ? "sdr" : "closer";
}

// ---------------------------------------------------------------------------
// Zod — schema do resultado montado a partir das chaves de dimensão da conta.
// É a fonte de verdade de validação (anti-alucinação) na borda da IA.
// ---------------------------------------------------------------------------

const evidenciaSchema = z.object({
  timestamp: z.string().min(1, "timestamp não pode ser vazio"),
  trecho: z.string(),
  comentario: z.string(),
});

const dimensaoSchema = z.object({
  score: z.number().int().min(0).max(10),
  evidencias: z.array(evidenciaSchema),
  resumo: z.string(),
});

const dadosCrmSchema = z.object({
  ticket: z.number().nullable().optional(),
  volume: z.number().nullable().optional(),
  publico: z.string().nullable().optional(),
  temperatura: z.string().nullable().optional(),
});

/** Constrói o schema de validação para um conjunto de chaves de dimensão. */
function montarAnaliseSchema(dimKeys: string[]) {
  const dimensoesShape = Object.fromEntries(
    dimKeys.map((k) => [k, dimensaoSchema]),
  ) as Record<string, typeof dimensaoSchema>;

  const prescricaoSchema = z.object({
    dimensao: z.string(),
    o_que_dizer: z.string(),
    exemplo_script: z.string(),
  });

  return z
    .object({
      dimensoes: z.object(dimensoesShape),
      nota: z.enum(["A", "B", "C"]),
      perda_estimada_reais: z.number().nullable(),
      perda_memoria_calculo: z.string().nullable(),
      dados_faltantes: z.array(z.string()),
      prescricoes: z.array(prescricaoSchema),
      proximos_passos: z.array(z.string()),
      dados_crm: dadosCrmSchema,
    })
    // Regra anti-alucinação na validação: se há perda, exige memória de cálculo.
    .refine(
      (a) =>
        a.perda_estimada_reais === null || a.perda_memoria_calculo !== null,
      {
        message:
          "perda_estimada_reais != null exige perda_memoria_calculo preenchida (memória de cálculo).",
        path: ["perda_memoria_calculo"],
      },
    );
}

export type AnaliseCall = z.infer<ReturnType<typeof montarAnaliseSchema>>;

export interface ResultadoAnalise {
  analise: AnaliseCall;
  uso: UsoTokens;
  /** Versão do template de prompt — propaga para a coluna ai_analyses (rastreio). */
  promptVersao: typeof PROMPT_VERSAO;
}

/**
 * Analisa uma call. `transcricaoNormalizada` deve vir do transcricao-extractor.
 * `config` é a MetodoConfig da conta (default = preset 3R).
 *
 * Força a tool via tool_choice e valida o input do tool_use com zod.
 * Não toca no banco; devolve os tokens para o caller gravar em usage_events.
 */
export async function analisarCall(
  transcricaoNormalizada: string,
  config: MetodoConfig = CONFIG_3R,
  objetivo: ObjetivoAnalise = "closer",
): Promise<ResultadoAnalise> {
  if (transcricaoNormalizada.trim() === "") {
    throw new Error("Transcrição vazia: não há o que analisar.");
  }

  // A régua SDR (qualificar + agendar) só se aplica ao preset de fábrica.
  // Se a conta customizou o método, respeitamos a config dela.
  const usarSdr = objetivo === "sdr" && !config.customizado;
  const dimensoes = usarSdr ? DIMENSOES_SDR : config.dimensoes;
  const systemPrompt = usarSdr ? SYSTEM_PROMPT_SDR : buildSystemPrompt(config);

  const tool = buildAnaliseTool(dimensoes);
  const schema = montarAnaliseSchema(dimensoes.map((d) => d.key));
  const client = getAnthropic();

  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 16000,
    system: systemCacheado(systemPrompt),
    tools: toolsCacheadas([tool]),
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: `Analise a call abaixo. Transcrição normalizada (formato "[timestamp] Falante: fala"):\n\n${transcricaoNormalizada}`,
      },
    ],
  });

  const toolInput = extrairToolInput(resposta, tool.name);
  const analise = schema.parse(toolInput);

  return {
    analise,
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}

/**
 * Extrai o `input` do bloco tool_use correspondente à tool forçada.
 * Lança erro claro se o modelo não chamou a tool (não deveria acontecer com
 * tool_choice forçado, mas blindamos contra refusal/edge cases).
 */
function extrairToolInput(resposta: Anthropic.Message, nomeTool: string): unknown {
  const bloco = resposta.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === nomeTool,
  );
  if (!bloco) {
    throw new Error(
      `O modelo não chamou a tool "${nomeTool}" (stop_reason: ${resposta.stop_reason}). Resposta inesperada da análise.`,
    );
  }
  return bloco.input;
}
