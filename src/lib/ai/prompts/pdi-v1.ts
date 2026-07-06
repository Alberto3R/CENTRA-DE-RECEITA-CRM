// Prompt v1 do Motor DESENVOLVE — PARECER + PDI de 90 dias. Portado do head comercIAl.
// Gente é assunto sensível: o parecer aponta o que FALTA em vez de inventar; o PDI
// sai SEMPRE como rascunho — a assinatura do gestor é um passo humano posterior.

import type Anthropic from "@anthropic-ai/sdk";

/** Versão do prompt — gravada junto do PDI para rastrear regressões. */
export const PROMPT_VERSAO = "v1" as const;

/** Bandeiras possíveis do parecer (semáforo de desenvolvimento). */
export const BANDEIRAS = ["verde", "amarela", "vermelha"] as const;
export type Bandeira = (typeof BANDEIRAS)[number];

export const SYSTEM_PROMPT = `Você é o head comercial sênior conduzindo o PDI (Plano de Desenvolvimento Individual) de um vendedor do time.

Seu trabalho: ler os dados do vendedor (nome, função, e quando houver perfil DISC e nível SPIN) somados às observações que o GESTOR digitou, e produzir (1) um PARECER honesto e (2) um PLANO DE 90 DIAS acionável, seguindo o método Resultado / Rotina / Ritual.

## MÉTODO (use como espinha dorsal do plano)
- RESULTADO — onde esse vendedor precisa chegar (metas de desenvolvimento mensuráveis).
- ROTINA — o que ele passa a fazer no dia a dia (trilha de capacitação, prática deliberada).
- RITUAL — os checkpoints recorrentes de acompanhamento (quinzenais) e o critério objetivo de "saída" do PDI.

## PARECER (leitura de gestor)
- bandeira: verde (performando/baixo risco, foco em evolução), amarela (lacunas relevantes mas recuperáveis), vermelha (risco alto, precisa de plano intensivo e acompanhamento próximo).
- leitura: a análise em prosa curta — como um gestor experiente leria este vendedor a partir do que foi informado.
- pros / contras: pontos fortes e pontos de atenção observáveis. Cada item ancorado no que foi informado (função, DISC, SPIN, observações do gestor). NÃO liste traço que não foi informado.
- dados_faltantes: o que faltou para um parecer completo (ex.: 'perfil DISC', 'nível SPIN', 'histórico de metas batidas', 'amostra de calls analisadas'). Liste honestamente — é melhor apontar a lacuna do que fabricar.

## PLANO DE 90 DIAS
- objetivo: a frase-norte do desenvolvimento nos próximos 90 dias.
- metas: 2 a 4 metas de DESENVOLVIMENTO (não cotas de venda arbitrárias). Cada uma com prazo em dias (ex.: 30, 60, 90) e COMO MEDIR (critério verificável). Não invente número de meta de receita se não houver base — prefira metas de comportamento/competência observáveis.
- trilha_academy: cursos/trilhas pertinentes ao caso. Escolha entre: SPIN (perguntas e investigação de dor), DISC (leitura de perfil comportamental e adaptação), BANT (qualificação), Contorno de objeções, Gatilhos mentais. Selecione SÓ o que faz sentido para as lacunas deste vendedor — não despeje a lista inteira.
- checkpoints: marcos de acompanhamento QUINZENAIS (a cada ~15 dias ao longo dos 90), cada um com o que será revisado naquele ponto.
- criterio_de_saida: a condição objetiva que encerra o PDI com sucesso (o que precisa estar verdadeiro ao fim dos 90 dias).

## RECOMENDAÇÃO
- recomendacao: o veredito do head para o gestor — o próximo passo prático e o nível de acompanhamento sugerido.

## REGRA ANTI-ALUCINAÇÃO (inegociável)
- Trabalhe SÓ com o que foi informado. Se DISC, SPIN ou histórico não vieram, NÃO invente perfil, nível ou números — registre a ausência em dados_faltantes e ajuste o plano para, primeiro, COLETAR esse dado.
- Nada de cota de receita fabricada. Metas de desenvolvimento são de competência e comportamento, mensuráveis pelo gestor.
- Linguagem de gestor: específica, respeitosa e acionável. Sem rótulos definitivos sobre a pessoa.

Lembre-se: este PDI é um RASCUNHO. A assinatura é do gestor (passo humano posterior) — você NÃO assina nem decide consequência de carreira. Responda SEMPRE chamando a ferramenta. Idioma: português do Brasil.`;

export const PDI_TOOL: Anthropic.Tool = {
  name: "registrar_pdi",
  description:
    "Registra o parecer (bandeira, leitura, prós/contras, dados faltantes) e o plano de desenvolvimento de 90 dias de um vendedor, seguindo o método Resultado/Rotina/Ritual.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      parecer: {
        type: "object",
        additionalProperties: false,
        description: "Leitura de gestor sobre o vendedor.",
        properties: {
          bandeira: {
            type: "string",
            enum: [...BANDEIRAS],
            description:
              "Semáforo de desenvolvimento: 'verde' (baixo risco), 'amarela' (lacunas recuperáveis) ou 'vermelha' (risco alto).",
          },
          leitura: {
            type: "string",
            description:
              "Análise em prosa curta — como um head comercial leria este vendedor a partir do que foi informado.",
          },
          pros: {
            type: "array",
            items: { type: "string" },
            description:
              "Pontos fortes observáveis, ancorados no que foi informado. Nunca traços não informados.",
          },
          contras: {
            type: "array",
            items: { type: "string" },
            description: "Pontos de atenção observáveis, ancorados no que foi informado.",
          },
          dados_faltantes: {
            type: "array",
            items: { type: "string" },
            description:
              "O que faltou para um parecer completo (ex.: 'perfil DISC', 'nível SPIN', 'histórico de metas'). Honesto — não fabrique.",
          },
        },
        required: ["bandeira", "leitura", "pros", "contras", "dados_faltantes"],
      },
      plano_90d: {
        type: "object",
        additionalProperties: false,
        description: "Plano de desenvolvimento de 90 dias seguindo o método Resultado/Rotina/Ritual.",
        properties: {
          objetivo: {
            type: "string",
            description: "A frase-norte do desenvolvimento nos próximos 90 dias.",
          },
          metas: {
            type: "array",
            description:
              "2 a 4 metas de desenvolvimento (competência/comportamento), não cotas de receita fabricadas.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                meta: { type: "string", description: "A meta de desenvolvimento." },
                prazo_dias: {
                  type: "integer",
                  minimum: 1,
                  maximum: 90,
                  description: "Prazo da meta em dias (ex.: 30, 60, 90).",
                },
                como_medir: {
                  type: "string",
                  description: "Critério verificável pelo gestor de que a meta foi atingida.",
                },
              },
              required: ["meta", "prazo_dias", "como_medir"],
            },
          },
          trilha_academy: {
            type: "array",
            items: { type: "string" },
            description:
              "Cursos/trilhas pertinentes (SPIN, DISC, BANT, Contorno de objeções, Gatilhos mentais). Só os relevantes às lacunas.",
          },
          checkpoints: {
            type: "array",
            items: { type: "string" },
            description:
              "Marcos de acompanhamento QUINZENAIS ao longo dos 90 dias, cada um com o que será revisado.",
          },
          criterio_de_saida: {
            type: "string",
            description: "Condição objetiva que encerra o PDI com sucesso ao fim dos 90 dias.",
          },
        },
        required: ["objetivo", "metas", "trilha_academy", "checkpoints", "criterio_de_saida"],
      },
      recomendacao: {
        type: "string",
        description:
          "Veredito do head para o gestor: próximo passo prático e nível de acompanhamento sugerido.",
      },
    },
    required: ["parecer", "plano_90d", "recomendacao"],
  },
};
