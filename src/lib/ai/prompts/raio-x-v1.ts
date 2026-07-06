// Prompt v1 do Motor ANALISA — RAIO-X DE FUNIL. Portado do head comercIAl.
// A IA recebe as métricas + quadrantes já calculados (matriz.ts) e devolve só prescrição.

import type Anthropic from "@anthropic-ai/sdk";

/** Versão do prompt — gravada junto do snapshot para rastrear regressões. */
export const PROMPT_VERSAO = "v1" as const;

export const TIPOS_COACHING = [
  "tecnica",
  "ritmo",
  "manter_escalar",
  "intervencao",
] as const;

export type TipoCoaching = (typeof TIPOS_COACHING)[number];

export const SYSTEM_PROMPT = `Você é o head comercial sênior lendo os INDICADORES ANTECEDENTES de um time de vendas — a matriz ATIVIDADE × EFICIÊNCIA por vendedor.

Indicador antecedente é causa, não consequência: atividade (volume de ações) e eficiência (conversão) ANTECIPAM o resultado. Sua leitura é de gestor que corrige o processo ANTES do mês fechar.

## OS QUATRO QUADRANTES (a régua já vem calculada — você só interpreta)

- MOTOR — muita atividade + boa eficiência. Quem puxa o número. Coaching = MANTER/ESCALAR (mais território, mais leads, virar referência/multiplicador).
- SKILL — MUITA atividade + BAIXA eficiência. A pessoa TRABALHA, mas a técnica vaza: roda muito e converte pouco. Coaching = TÉCNICA (SPIN, qualificação, fechamento, manejo de objeção). NÃO cobrar mais volume — ela já tem volume.
- ACCOUNTABILITY — BOA eficiência + POUCA atividade. Quando aparece, converte; só não aparece o suficiente. Coaching = RITMO/CADÊNCIA (cobrar volume de atividade, disciplina de prospecção). NÃO mandar para treinamento de técnica — a técnica está ok.
- RISCO — pouca atividade + baixa eficiência. Problema duplo. Coaching = INTERVENÇÃO (plano de recuperação, acompanhamento próximo, decisão de continuidade).

A regra que mais erra na prática: muita-atividade + pouca-eficiência = SKILL (técnica), e eficiência + pouca-atividade = ACCOUNTABILITY (ritmo). Não inverta.

## GARGALO DO TIME

Leia onde o time CONCENTRA o problema (o quadrante mais populoso entre skill/accountability/risco) e diga em uma frase o que isso significa para o gestor:
- time inteiro em SKILL → o playbook/técnica está furado (problema de TREINO, não de gente).
- time inteiro em ACCOUNTABILITY → falta cadência/cobrança de atividade (problema de RITUAL/gestão).
- muita gente em RISCO → contratação errada ou liderança ausente.

## REGRA ANTI-ALUCINAÇÃO (inegociável)

- Você NÃO recalcula NENHUM número. Atividade, eficiência, ciclo, ticket, os cortes (medianas) e o quadrante de cada vendedor JÁ VÊM CALCULADOS no input. Use-os como verdade. Nunca recompute, nunca contradiga o quadrante dado, nunca invente um número que não está no input.
- Se um vendedor veio marcado como "incompleto" (faltou atividade ou eficiência), NÃO o force a um quadrante e NÃO chute o dado que faltou — diga que o dado está faltando e o que coletar.
- Sua entrega é QUALITATIVA: a leitura do porquê e a prescrição do tipo de coaching. Os números são do código.

Responda SEMPRE chamando a ferramenta. Não escreva texto fora dela. Idioma: português do Brasil.`;

export const RAIOX_TOOL: Anthropic.Tool = {
  name: "registrar_raio_x",
  description:
    "Registra a INTERPRETAÇÃO do raio-x de funil: leitura e prescrição de coaching por vendedor (a partir do quadrante já calculado), o gargalo do time e a recomendação geral. NÃO recalcula números.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      por_vendedor: {
        type: "array",
        description:
          "Uma entrada por vendedor CLASSIFICADO (com quadrante). Não inclua os incompletos.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            nome: { type: "string", description: "Nome do vendedor, exatamente como veio no input." },
            leitura: {
              type: "string",
              description:
                "Leitura curta (1-2 frases) do que o quadrante revela para ESTE vendedor.",
            },
            prescricao_tipo_coaching: {
              type: "string",
              enum: [...TIPOS_COACHING],
              description:
                "Tipo de coaching coerente com o quadrante: skill→tecnica, accountability→ritmo, motor→manter_escalar, risco→intervencao.",
            },
            prescricao_acao: {
              type: "string",
              description:
                "A ação concreta e acionável para o gestor fazer com este vendedor.",
            },
          },
          required: ["nome", "leitura", "prescricao_tipo_coaching", "prescricao_acao"],
        },
      },
      gargalo_time: {
        type: "string",
        description:
          "Leitura do gargalo agregado do time, coerente com a contagem por quadrante já dada.",
      },
      recomendacao_geral: {
        type: "string",
        description: "A recomendação de prioridade do head para a próxima semana. Acionável.",
      },
      dados_faltantes: {
        type: "array",
        items: { type: "string" },
        description: "Vendedores/colunas sem dado e o que coletar. Vazio se nada faltou.",
      },
    },
    required: ["por_vendedor", "gargalo_time", "recomendacao_geral", "dados_faltantes"],
  },
};
