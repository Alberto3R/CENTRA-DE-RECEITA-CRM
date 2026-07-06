// Prompt v1 da análise de call (7 dimensões), PARAMETRIZADO por conta.
//
// Portado do head comercIAl e generalizado para o SaaS de mercado:
//   - SYSTEM_PROMPT_3R: persona + método 3R verbatim (preset de fábrica).
//   - buildSystemPrompt(config): monta o system prompt da conta. Sem customização
//     (config.customizado === false), retorna SYSTEM_PROMPT_3R byte-a-byte —
//     zero regressão para a Sales 3R.
//   - buildAnaliseTool(dimKeys): tool (tool_use) cujo input_schema é o formato
//     obrigatório de saída. O caller força tool_choice para esta tool.
//   - PROMPT_VERSAO: marca a versão do TEMPLATE; a config da conta é registrada
//     junto da análise para rastrear regressões no golden set.

import type Anthropic from "@anthropic-ai/sdk";

import {
  DIMENSOES_3R,
  simboloMoeda,
  type DimensaoSpec,
  type MetodoConfig,
} from "../method-config";

/** Versão do template de prompt — gravada junto da análise (rastreio de regressão). */
export const PROMPT_VERSAO = "v1" as const;

/** Chaves das 7 dimensões 3R (ordem canônica) — usada pelo golden set. */
export const DIMENSOES_3R_KEYS = DIMENSOES_3R.map((d) => d.key);

/** System prompt 3R VERBATIM — preset de fábrica. */
export const SYSTEM_PROMPT_3R = `Você é o head comercial sênior da Sales 3R analisando uma call de vendas B2B.

Seu trabalho: ouvir a transcrição como um gestor experiente ouviria, e produzir um diagnóstico acionável seguindo o MÉTODO 3R (Resultado, Rotina, Ritual). Você não é um robô que dá nota — você é quem mostra ONDE o dinheiro vazou e O QUE o vendedor deveria ter dito.

## AS 7 DIMENSÕES (avalie TODAS, sempre nesta ordem)

1. abertura_rapport — Como abriu? Criou conexão, quebrou o gelo, ancorou autoridade?
2. qualificacao_fit — Entendeu se o lead tem fit (orçamento, autoridade, necessidade, timing)?
3. spin — Aplicou SPIN: Situação, Problema, Implicação, Necessidade de solução? Cavou a dor?
4. apresentacao — Apresentou a solução conectada à dor levantada, ou despejou features?
5. preco — Como ancorou e defendeu o preço? Adiou, amarrou em valor, deu desconto fácil?
6. objecoes — Identificou e contornou objeções, ou aceitou o "vou pensar"?
7. fechamento_proximos_passos — Pediu o avanço? Marcou próximo passo com data e compromisso?

## PADRÃO DE SAÍDA OBRIGATÓRIO (por dimensão)

Para cada ponto relevante, encadeie:
1. EVIDÊNCIA — cite o trecho real da transcrição COM O TIMESTAMP real ([mm:ss] ou [hh:mm:ss]) onde aconteceu. Nunca invente timestamp.
2. PERDA EM R$ — quando a falha tem impacto financeiro mensurável, quantifique em reais COM memória de cálculo (mostre a conta).
3. PRESCRIÇÃO — o que o vendedor deveria ter dito/feito, com exemplo de script pronto pra usar.

## REGRA ANTI-ALUCINAÇÃO (inegociável)

- TIMESTAMP: toda evidência precisa de um timestamp que EXISTE na transcrição. Se a transcrição não tem timestamps, use o marcador de turno disponível; se não há referência alguma, NÃO invente — descreva o momento sem fabricar número.
- PERDA EM R$: para calcular perda em reais você precisa de dados do cliente (ticket médio, volume de leads, taxa de conversão). Se ESSES DADOS NÃO ESTÃO na transcrição nem no contexto fornecido, deixe perda_estimada_reais = null, deixe perda_memoria_calculo = null, e LISTE o que faltou em dados_faltantes. NUNCA invente ticket, volume ou número de perda.
- Não afirme que algo "foi dito" sem o trecho. Sem evidência, não há acusação.
- Prescrição sempre acionável: "o que dizer", não "deveria ter sido melhor".

## NOTA

Atribua nota A, B ou C à call como um todo:
- A = executou bem as dimensões críticas, perdas pequenas e contornáveis.
- B = lacunas relevantes mas recuperáveis, dinheiro na mesa identificável.
- C = falhas graves em dimensões críticas (qualificação, SPIN, fechamento), alto risco de perda.

Responda SEMPRE chamando a ferramenta de análise. Não escreva texto fora da ferramenta. Idioma: português do Brasil.`;

/**
 * Monta o system prompt da conta. Sem customização, devolve o 3R verbatim.
 * Com customização, monta um prompt equivalente a partir de método/tom/dimensões.
 */
export function buildSystemPrompt(config: MetodoConfig): string {
  if (!config.customizado) {
    return SYSTEM_PROMPT_3R;
  }

  const moeda = simboloMoeda(config.moeda);
  const persona = config.tomDeVoz?.trim()
    ? config.tomDeVoz.trim()
    : `Você é o head comercial sênior analisando uma call de vendas B2B pelo método ${config.metodoNome}.`;

  const linhasDimensoes = config.dimensoes
    .map((d, i) => `${i + 1}. ${d.key} — ${d.descricao}`)
    .join("\n");

  const icpBloco =
    config.icp && Object.keys(config.icp).length > 0
      ? `\n## CONTEXTO DA EMPRESA (ICP)\n\n${JSON.stringify(config.icp, null, 2)}\n`
      : "";

  return `${persona}

Seu trabalho: ouvir a transcrição como um gestor experiente ouviria, e produzir um diagnóstico acionável pelo método ${config.metodoNome}. Você não é um robô que dá nota — você mostra ONDE o dinheiro vazou e O QUE o vendedor deveria ter dito.
${icpBloco}
## AS DIMENSÕES (avalie TODAS, sempre nesta ordem)

${linhasDimensoes}

## PADRÃO DE SAÍDA OBRIGATÓRIO (por dimensão)

Para cada ponto relevante, encadeie:
1. EVIDÊNCIA — cite o trecho real da transcrição COM O TIMESTAMP real ([mm:ss] ou [hh:mm:ss]) onde aconteceu. Nunca invente timestamp.
2. PERDA EM ${moeda} — quando a falha tem impacto financeiro mensurável, quantifique COM memória de cálculo (mostre a conta).
3. PRESCRIÇÃO — o que o vendedor deveria ter dito/feito, com exemplo de script pronto pra usar.

## REGRA ANTI-ALUCINAÇÃO (inegociável)

- TIMESTAMP: toda evidência precisa de um timestamp que EXISTE na transcrição. Se não há referência alguma, NÃO invente — descreva o momento sem fabricar número.
- PERDA EM ${moeda}: para calcular a perda você precisa de dados do cliente (ticket médio, volume, taxa de conversão). Se NÃO estão na transcrição nem no contexto, deixe perda_estimada_reais = null, perda_memoria_calculo = null, e liste o que faltou em dados_faltantes. NUNCA invente número.
- Não afirme que algo "foi dito" sem o trecho. Sem evidência, não há acusação.
- Prescrição sempre acionável: "o que dizer", não "deveria ter sido melhor".

## NOTA

Atribua nota A, B ou C à call como um todo (A = boa execução, perdas pequenas; B = lacunas recuperáveis; C = falhas graves em dimensões críticas).

Responda SEMPRE chamando a ferramenta de análise. Não escreva texto fora da ferramenta. Idioma: português do Brasil.`;
}

// ---------------------------------------------------------------------------
// Schema da tool (tool_use) — montado a partir das chaves de dimensão da conta.
// ---------------------------------------------------------------------------

function dimensaoSchemaJson(dim: string): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    description: `Avaliação da dimensão ${dim}.`,
    properties: {
      score: {
        type: "integer",
        minimum: 0,
        maximum: 10,
        description: "Nota da dimensão, de 0 a 10.",
      },
      evidencias: {
        type: "array",
        description:
          "Evidências da transcrição. Cada uma com timestamp REAL (não inventado), trecho citado e comentário.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            timestamp: {
              type: "string",
              description:
                "Timestamp real do trecho na transcrição ([mm:ss] ou [hh:mm:ss]). Nunca vazio, nunca inventado.",
            },
            trecho: {
              type: "string",
              description: "Trecho citado literalmente da transcrição.",
            },
            comentario: {
              type: "string",
              description: "O que esse trecho revela sobre a dimensão.",
            },
          },
          required: ["timestamp", "trecho", "comentario"],
        },
      },
      resumo: {
        type: "string",
        description: "Resumo da performance do vendedor nesta dimensão.",
      },
    },
    required: ["score", "evidencias", "resumo"],
  };
}

/**
 * Constrói a tool de análise para o conjunto de dimensões da conta. O input_schema
 * É o formato de saída obrigatório. O caller força tool_choice para esta tool.
 */
export function buildAnaliseTool(dimensoes: DimensaoSpec[]): Anthropic.Tool {
  const keys = dimensoes.map((d) => d.key);
  return {
    name: "registrar_analise_call",
    description:
      "Registra a análise estruturada de uma call de vendas seguindo as dimensões do método da conta e o padrão evidência -> perda em dinheiro -> prescrição.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        dimensoes: {
          type: "object",
          additionalProperties: false,
          description: "As dimensões avaliadas. TODAS são obrigatórias.",
          properties: Object.fromEntries(
            keys.map((dim) => [dim, dimensaoSchemaJson(dim)]),
          ),
          required: [...keys],
        },
        nota: {
          type: "string",
          enum: ["A", "B", "C"],
          description: "Nota geral da call.",
        },
        perda_estimada_reais: {
          type: ["number", "null"],
          description:
            "Perda total estimada (na moeda da conta). null se não há dados (ticket/volume) para calcular — nunca invente.",
        },
        perda_memoria_calculo: {
          type: ["string", "null"],
          description:
            "Memória de cálculo da perda (a conta passo a passo). null se perda_estimada_reais for null.",
        },
        dados_faltantes: {
          type: "array",
          items: { type: "string" },
          description:
            "Dados do cliente que faltaram para quantificar perdas (ex.: 'ticket médio', 'volume mensal de leads').",
        },
        prescricoes: {
          type: "array",
          description: "Prescrições acionáveis — o que dizer/fazer.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              dimensao: {
                type: "string",
                enum: [...keys],
                description: "Dimensão a que a prescrição se refere.",
              },
              o_que_dizer: {
                type: "string",
                description: "A orientação acionável.",
              },
              exemplo_script: {
                type: "string",
                description: "Exemplo de fala/script pronto para usar.",
              },
            },
            required: ["dimensao", "o_que_dizer", "exemplo_script"],
          },
        },
        proximos_passos: {
          type: "array",
          items: { type: "string" },
          description: "Próximos passos recomendados para o vendedor/gestor.",
        },
        dados_crm: {
          type: "object",
          additionalProperties: false,
          description:
            "Dados de CRM inferidos da call, quando explicitamente mencionados. Todos opcionais.",
          properties: {
            ticket: {
              type: ["number", "null"],
              description: "Ticket mencionado na call.",
            },
            volume: {
              type: ["number", "null"],
              description: "Volume (de leads/clientes) mencionado.",
            },
            publico: {
              type: ["string", "null"],
              description: "Público/segmento do lead, se mencionado.",
            },
            temperatura: {
              type: ["string", "null"],
              description: "Temperatura do lead (frio/morno/quente), se inferível.",
            },
          },
        },
      },
      required: [
        "dimensoes",
        "nota",
        "perda_estimada_reais",
        "perda_memoria_calculo",
        "dados_faltantes",
        "prescricoes",
        "proximos_passos",
        "dados_crm",
      ],
    },
  };
}
