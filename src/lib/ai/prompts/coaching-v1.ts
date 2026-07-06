// Prompt v1 do Motor DESENVOLVE — RITMO DE COACHING. Portado do head comercIAl.
// Transforma as análises acumuladas de UM vendedor num ciclo de coaching da semana.

import type Anthropic from "@anthropic-ai/sdk";

/** Versão do prompt — gravada junto do ciclo para rastrear regressões. */
export const PROMPT_VERSAO = "v1" as const;

/** As 7 dimensões padrão (mesma ordem canônica da análise de call). */
export const DIMENSOES = [
  "abertura_rapport",
  "qualificacao_fit",
  "spin",
  "apresentacao",
  "preco",
  "objecoes",
  "fechamento_proximos_passos",
] as const;

export type Dimensao = (typeof DIMENSOES)[number];

export const DIMENSAO_LABEL: Record<Dimensao, string> = {
  abertura_rapport: "Abertura & Rapport",
  qualificacao_fit: "Qualificação & Fit",
  spin: "SPIN",
  apresentacao: "Apresentação",
  preco: "Preço",
  objecoes: "Objeções",
  fechamento_proximos_passos: "Fechamento & Próximos passos",
};

export const SYSTEM_PROMPT = `Você é o head comercial sênior montando o CICLO DE COACHING DA SEMANA de UM vendedor, para que o GESTOR conduza o 1:1.

Você recebe as análises de call acumuladas desse vendedor (cada uma com as 7 dimensões pontuadas de 0 a 10, a nota A/B/C e as prescrições). Seu trabalho NÃO é refazer a análise — é destilar tudo num plano de coaching que o gestor abre na reunião e executa. Você PREPARA; o gestor CONDUZ e fecha um combinado com o vendedor.

## MÉTODO (as 3 camadas da pauta do 1:1)

- RESULTADO — o número/entrega da semana: o que precisa sair (avançar negócio, marcar próximo passo, recuperar dinheiro na mesa). Fala do PLACAR.
- ROTINA — o hábito/comportamento de execução: o que o vendedor faz toda call/todo dia (cadência, preparação, registro no CRM, número de tentativas). Fala do COMO.
- RITUAL — o ritmo de acompanhamento e reforço: o role play, o checkpoint, a recorrência do combinado, o reconhecimento. Fala da CADÊNCIA de desenvolvimento.

## O QUE VOCÊ ENTREGA

1. DEAL COACHING — pegue a PIOR dimensão recente (a com menor score nas análises mais novas) e UM trecho/evidência concreto a corrigir AINDA ESTA SEMANA, num negócio real do vendedor. Acionável: o que fazer, não "deveria ter sido melhor".
2. SKILL COACHING — a dimensão com a PIOR NOTA RECORRENTE (baixa de forma consistente ao longo das análises, não um tropeço isolado). Diagnostique a causa e proponha UM exercício dirigido + um roteiro de role play para o gestor rodar.
3. PAUTA 1:1 — preencha as 3 camadas (resultado, rotina, ritual) já prontas para o gestor abrir a reunião.
4. COMBINADO — o desafio que o gestor vai propor para o vendedor assumir, com um prazo (a IA sugere; quem fecha é o gestor com o vendedor).
5. OBSERVAÇÃO DA CURVA — uma leitura curta da evolução das notas por dimensão ao longo das análises (está subindo? travou? regrediu?).

## REGRA ANTI-ALUCINAÇÃO (inegociável)

- NÃO INVENTE HISTÓRICO. Você só conhece o vendedor pelas análises que recebeu. Se há poucas análises (cold start), trabalhe SÓ com deal coaching sobre o que existe e, na observacao_curva, diga explicitamente que a curva de evolução começa a ser lida a partir da 2ª semana/2ª análise — NÃO descreva uma tendência que não dá para ver com 1 ponto.
- A dimensao_alvo do skill coaching DEVE ser uma das 7 dimensões canônicas — nunca uma inventada.
- Toda evidência do deal coaching vem de um trecho REAL das análises fornecidas. Sem trecho, não há acusação — descreva o ponto sem fabricar fala ou timestamp.
- NÃO invente número (score, perda em R$, meta numérica) que não esteja nas análises. Se faltar dado, diga o que falta em vez de preencher.
- Combinado/prazo é SUGESTÃO para o gestor fechar — deixe isso claro no tom.

Responda SEMPRE chamando a ferramenta de coaching. Não escreva texto fora da ferramenta. Idioma: português do Brasil.`;

export const COACHING_TOOL: Anthropic.Tool = {
  name: "registrar_ciclo_coaching",
  description:
    "Registra o ciclo de coaching da semana de um vendedor: deal coaching, skill coaching, pauta 1:1 nas 3 camadas (Resultado/Rotina/Ritual), combinado e observação da curva.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      deal_coaching: {
        type: "object",
        additionalProperties: false,
        description:
          "Correção de UM negócio/ponto concreto a tratar ainda esta semana, a partir da pior dimensão recente.",
        properties: {
          negocio_ou_trecho: {
            type: "string",
            description: "O negócio ou o trecho/momento real (da análise) que precisa de correção.",
          },
          evidencia: {
            type: "string",
            description:
              "A evidência concreta (trecho citado / o que aconteceu) que justifica a correção. Não fabrique fala.",
          },
          o_que_fazer_esta_semana: {
            type: "string",
            description:
              "Ação acionável que o vendedor deve executar ESTA semana — o que dizer/fazer, não 'melhorar'.",
          },
        },
        required: ["negocio_ou_trecho", "evidencia", "o_que_fazer_esta_semana"],
      },
      skill_coaching: {
        type: ["object", "null"],
        additionalProperties: false,
        description:
          "Desenvolvimento da dimensão com pior nota RECORRENTE. null no cold start (poucas análises) — nesse caso explique na observacao_curva.",
        properties: {
          dimensao_alvo: {
            type: "string",
            enum: [...DIMENSOES],
            description: "A dimensão (das 7 canônicas) com pior nota recorrente.",
          },
          diagnostico: {
            type: "string",
            description:
              "Por que essa dimensão está baixa de forma consistente — a causa, com base nas análises.",
          },
          exercicio: { type: "string", description: "Exercício dirigido para treinar a dimensão-alvo." },
          roteiro_role_play: {
            type: "string",
            description:
              "Roteiro de role play pronto para o gestor rodar (cenário + falas a praticar).",
          },
        },
        required: ["dimensao_alvo", "diagnostico", "exercicio", "roteiro_role_play"],
      },
      pauta_1on1: {
        type: "object",
        additionalProperties: false,
        description: "A pauta do 1:1 nas 3 camadas (Resultado/Rotina/Ritual).",
        properties: {
          resultado: { type: "string", description: "Camada RESULTADO — o número/entrega da semana." },
          rotina: { type: "string", description: "Camada ROTINA — o hábito/comportamento a ajustar." },
          ritual: {
            type: "string",
            description: "Camada RITUAL — o ritmo de acompanhamento/reforço (role play, checkpoint).",
          },
        },
        required: ["resultado", "rotina", "ritual"],
      },
      combinado: {
        type: "object",
        additionalProperties: false,
        description: "O desafio sugerido para o gestor fechar com o vendedor.",
        properties: {
          desafio: { type: "string", description: "O combinado/desafio que o vendedor assume na semana." },
          prazo: { type: "string", description: "Prazo sugerido (ex.: 'até a próxima 1:1', '7 dias')." },
        },
        required: ["desafio", "prazo"],
      },
      observacao_curva: {
        type: "string",
        description:
          "Leitura curta da evolução das notas ao longo das análises. No cold start, diga que a curva começa a ser lida a partir da 2ª análise — não invente tendência.",
      },
    },
    required: ["deal_coaching", "skill_coaching", "pauta_1on1", "combinado", "observacao_curva"],
  },
};
