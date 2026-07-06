import type { ModeloAnthropic } from "./anthropic";

/**
 * Estimativa de custo em USD por chamada de IA, para a telemetria (usage_events).
 *
 * 📊 ESTIMATIVA — preços por 1 milhão de tokens (entrada/saída). Os valores abaixo
 * são aproximados e DEVEM ser conferidos contra a tabela de preços vigente da
 * Anthropic antes de usar para faturamento. Servem para medir ordem de grandeza
 * do custo por análise (define o fair use e a margem dos planos), não para
 * cobrança exata.
 */
const PRECO_POR_MILHAO_USD: Record<
  ModeloAnthropic,
  { entrada: number; saida: number }
> = {
  "claude-sonnet-4-6": { entrada: 3, saida: 15 },
  "claude-haiku-4-5-20251001": { entrada: 1, saida: 5 },
};

export function calcularCustoUsd(
  modelo: ModeloAnthropic,
  tokensIn: number,
  tokensOut: number,
): number {
  const p = PRECO_POR_MILHAO_USD[modelo];
  if (!p) return 0;
  const custo =
    (tokensIn / 1_000_000) * p.entrada + (tokensOut / 1_000_000) * p.saida;
  // arredonda para 6 casas (frações de centavo de dólar)
  return Math.round(custo * 1_000_000) / 1_000_000;
}
