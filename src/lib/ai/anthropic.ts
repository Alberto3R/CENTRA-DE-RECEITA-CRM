// Wrapper do Anthropic SDK para o módulo de IA de gestão comercial.
//
// Portado do head comercIAl (regra de fusão: a lógica de IA entra, a infra do
// HEAD é descartada). Centraliza a criação do client e os IDs de modelo usados
// pelos motores de análise/geração. Lê ANTHROPIC_API_KEY do ambiente.
//
// Model IDs FIXOS (decisão de produto — não troque sem alinhar custo/qualidade):
//   - Análise/geração (tool_use com schema) -> claude-sonnet-4-6
//   - Triagem/validação barata              -> claude-haiku-4-5-20251001

import Anthropic from "@anthropic-ai/sdk";

/**
 * Modelo de análise (raciocínio): usado na análise de call das 7 dimensões,
 * geração de scripts, contorno de objeções e parecer de PDI.
 */
export const MODELO_ANALISE = "claude-sonnet-4-6" as const;

/**
 * Modelo de triagem/validação: tarefas baratas e rápidas — checar se um documento
 * é uma transcrição válida, classificar tipo de arquivo, normalizações simples.
 */
export const MODELO_TRIAGEM = "claude-haiku-4-5-20251001" as const;

/**
 * Tipo de união dos modelos que o app conhece. Útil para tipar telemetria
 * (usage_events.modelo) sem aceitar qualquer string.
 */
export type ModeloAnthropic = typeof MODELO_ANALISE | typeof MODELO_TRIAGEM;

/**
 * Resolve a API key do ambiente. Lança erro explícito em vez de deixar o SDK
 * falhar com mensagem genérica de autenticação — facilita o debug em dev.
 */
function resolverApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY não definida no ambiente. Configure a variável antes de chamar a IA de gestão comercial.",
    );
  }
  return apiKey;
}

/**
 * Client singleton do Anthropic. Criado de forma preguiçosa (lazy) para que o
 * módulo possa ser importado em contextos sem a env var (ex.: build, type-check)
 * sem estourar — o erro só acontece no primeiro uso real.
 */
let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client === null) {
    _client = new Anthropic({ apiKey: resolverApiKey() });
  }
  return _client;
}

/**
 * Telemetria de uso de um request (in/out tokens) para persistir em usage_events.
 * Calculada pelo caller no servidor — esta camada de IA apenas devolve os números.
 */
export interface UsoTokens {
  modelo: ModeloAnthropic;
  tokens_in: number;
  tokens_out: number;
}

// ---------------------------------------------------------------------------
// Prompt caching (corta o custo de input). Os system prompts e os schemas de
// tool são grandes e reusados a cada chamada — marcá-los como `ephemeral` faz a
// Anthropic cachear (~90% mais barato no input em cache hit, TTL ~5min). Para o
// preset 3R (idêntico entre contas) o hit é altíssimo.
// ---------------------------------------------------------------------------

/** Envolve o system prompt num bloco com cache_control ephemeral. */
export function systemCacheado(prompt: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }];
}

/** Marca a última tool com cache_control ephemeral (cacheia o schema das tools). */
export function toolsCacheadas(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  if (tools.length === 0) return tools;
  return tools.map((t, i) =>
    i === tools.length - 1
      ? { ...t, cache_control: { type: "ephemeral" } }
      : t,
  );
}
