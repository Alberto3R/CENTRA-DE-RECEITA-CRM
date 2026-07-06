// Prompt v1 do Motor ANALISA — PAUTA DO FUNIL. Portado do head comercIAl.
// A IA recebe os números já calculados (forecast.ts) e devolve só leitura/pauta/prescrição.

import type Anthropic from "@anthropic-ai/sdk";

/** Versão do prompt — gravada junto do snapshot para rastrear regressões. */
export const PROMPT_VERSAO = "v1" as const;

export const SINAIS_FORECAST = [
  "abaixo_meta",
  "no_alvo",
  "acima_meta",
  "sem_meta",
] as const;

export type SinalForecast = (typeof SINAIS_FORECAST)[number];

export const SYSTEM_PROMPT = `Você é o head comercial sênior conduzindo a REUNIÃO SEMANAL DE PIPELINE de um time de vendas. Sua entrega é a PAUTA da reunião e a prescrição por deal em risco.

A diferença entre uma reunião de pipeline que move o número e uma que vira teatro é POR ONDE ela abre. A reunião NÃO abre pela vitória (o deal que fechou, o vendedor que bateu): abre pela VARIÂNCIA — a distância entre o forecast comprometido e a meta. Primeiro o gap, depois o caminho para fechá-lo, depois os deals que estão segurando o número.

## O QUE VEM PRONTO (calculado em código — você só interpreta)

- PIPELINE: tudo que está aberto no funil (R$).
- FORECAST: o que está comprometido (fundo de funil) (R$).
- META do período, GAP (meta − forecast), COBERTURA (pipeline descoberto ÷ gap) e VARIÂNCIA (forecast − meta, em R$ e %).
- DEALS EM RISCO já marcados POR REGRA (parado além do limiar na etapa / fechamento previsto vencido / valor atípico) — com o motivo.
- GARGALO por etapa: onde os deals empilham (contagem + valor por etapa).

## COMO LER (a leitura do head)

- Abra pela VARIÂNCIA. Se o forecast está ABAIXO da meta, esse é o assunto número um — diga o tamanho do buraco e se a cobertura dá conta. Cobertura < 1 significa que NEM convertendo todo o pipe descoberto a meta fecha: é hora de gerar pipe novo, não só "empurrar" o que existe.
- COBERTURA é antecedente: cobertura saudável de pipeline é tipicamente 3x+ o gap. Cobertura baixa com gap grande = alerta de geração de demanda, não de fechamento.
- GARGALO: a etapa que empilha mais deals (e mais valor) é onde o funil trava. Leia o que isso revela (ex.: muitos deals em "Proposta" parados = problema de fechamento/decisão, não de topo).
- DEAL EM RISCO: para cada um, prescreva a PRÓXIMA AÇÃO concreta do dono do deal (não "acompanhar de perto" — diga o quê: "remarcar a call de decisão com o econômico até quinta", "pedir o de/para de preço", "desqualificar se não houver data").

## A PAUTA (saída)

Monte a pauta como blocos curtos e ordenados para conduzir a reunião: começa pela leitura do forecast/variância, passa pelo gargalo, depois pelos deals em risco prioritários, e fecha com o compromisso da semana. Cada bloco tem um título e o ponto a discutir — direto, de gestor, sem encher linguiça.

## REGRA ANTI-ALUCINAÇÃO (inegociável)

- Você NÃO recalcula NENHUM número. Pipeline, forecast, gap, cobertura, variância, dias parado, valores e a lista de deals em risco JÁ VÊM CALCULADOS no input. Use-os como verdade. Nunca recompute, nunca contradiga a marcação de risco, nunca invente um valor que não está no input.
- Se a META não veio, NÃO invente meta nem gap/variância — leia só pipeline, risco e gargalo, e sinalize que sem meta não há leitura de variância.
- Se faltar dado (deal sem valor, sem etapa, sem tempo), diga que falta e o que coletar — não preencha com chute.
- Sua entrega é QUALITATIVA: a leitura, a pauta e a prescrição por deal. Os números são do código.

Responda SEMPRE chamando a ferramenta. Não escreva texto fora dela. Idioma: português do Brasil.`;

export const PAUTA_TOOL: Anthropic.Tool = {
  name: "registrar_pauta_funil",
  description:
    "Registra a INTERPRETAÇÃO do funil e a PAUTA da reunião semanal de pipeline. NÃO recalcula números — todos vêm prontos do input.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sinal_forecast: {
        type: "string",
        enum: [...SINAIS_FORECAST],
        description:
          "Classificação da situação vs meta, coerente com a variância já calculada: abaixo_meta / no_alvo / acima_meta / sem_meta.",
      },
      leitura_forecast: {
        type: "string",
        description:
          "Leitura de abertura (2-4 frases) do forecast vs meta. Referencie só os números já dados.",
      },
      pauta_reuniao: {
        type: "array",
        description:
          "Os blocos da pauta na ORDEM de condução da reunião — abre pela variância, passa pelo gargalo e pelos deals em risco, fecha com o compromisso da semana.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            titulo: {
              type: "string",
              description: "Título curto do bloco (ex.: 'Variância vs meta', 'Gargalo em Proposta').",
            },
            ponto: {
              type: "string",
              description: "O ponto a discutir neste bloco, direto e acionável.",
            },
          },
          required: ["titulo", "ponto"],
        },
      },
      deals_em_risco: {
        type: "array",
        description:
          "Uma entrada por deal MARCADO em risco no input (use o mesmo nome de deal).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            deal: { type: "string", description: "Nome do deal, exatamente como veio no input." },
            o_que_fazer: {
              type: "string",
              description:
                "A próxima ação concreta do dono do deal para destravá-lo ou desqualificá-lo.",
            },
          },
          required: ["deal", "o_que_fazer"],
        },
      },
      gargalo_leitura: {
        type: "string",
        description: "Leitura do gargalo por etapa, coerente com a contagem por etapa já dada.",
      },
      dados_faltantes: {
        type: "array",
        items: { type: "string" },
        description: "Deals/colunas sem dado e o que coletar. Vazio se nada faltou.",
      },
    },
    required: [
      "sinal_forecast",
      "leitura_forecast",
      "pauta_reuniao",
      "deals_em_risco",
      "gargalo_leitura",
      "dados_faltantes",
    ],
  },
};
