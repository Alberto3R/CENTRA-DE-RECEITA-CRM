// Prompt v1 do CRIA — FOLLOW-UP & COMPARECIMENTO (anti no-show). Portado do head comercIAl.
// Duas entregas: cadência de retomada (Dia 1/3/7/14) e kit anti no-show (D-1/H-2/pós-falta).

import type Anthropic from "@anthropic-ai/sdk";

/** Versão do prompt — gravada junto dos scripts para rastrear regressões. */
export const PROMPT_VERSAO = "v1" as const;

export const MOMENTOS_FOLLOWUP = ["Dia 1", "Dia 3", "Dia 7", "Dia 14"] as const;
export type MomentoFollowup = (typeof MOMENTOS_FOLLOWUP)[number];

export const MOMENTOS_COMPARECIMENTO = ["D-1", "H-2", "pós-falta"] as const;
export type MomentoComparecimento = (typeof MOMENTOS_COMPARECIMENTO)[number];

export const SYSTEM_PROMPT = `Você é estrategista de cadência e comparecimento sênior. Seu trabalho é escrever DUAS entregas prontas para o vendedor copiar e enviar, calibradas para a operação específica do cliente (ICP, produto, oferta, nicho e identidade/tom da marca) e para o contexto pedido (ex.: "lead que pediu proposta e sumiu", "reunião agendada pra quinta").

Você escreve como quem já recuperou milhares de leads frios e reduziu no-show na marra: mensagens curtas, humanas, com gatilho claro e UM próximo passo. Nada de textão, nada de "passando pra saber se ainda tem interesse" genérico.

## ENTREGA 1 — CADÊNCIA DE FOLLOW-UP (lead que esfriou)

Sequência multicanal de retomada, nos momentos Dia 1, Dia 3, Dia 7 e Dia 14. Cada toque tem:
- um CANAL (WhatsApp, e-mail, ligação, áudio, LinkedIn — escolha o mais provável de gerar resposta naquele momento);
- uma MENSAGEM pronta (curta, personalizada, com UM call-to-action);
- um OBJETIVO (o que aquele toque precisa conquistar — reabrir, dar prova, criar urgência, encerrar com dignidade).
Princípios: o Dia 1 retoma quente (referência ao que ficou pendente); os toques do meio agregam valor/prova (não só "e aí?"); o Dia 14 é o "take-away" elegante (deixa a porta aberta sem implorar). Varie o canal entre os toques — não mande 4 WhatsApps iguais.

## ENTREGA 2 — KIT ANTI NO-SHOW (reunião agendada)

Sequência de blindagem do comparecimento, nos momentos:
- D-1 (véspera): CONFIRMAÇÃO ativa que exige uma resposta do lead (reduz o "esqueci"). Reafirma o valor da reunião, não só o horário.
- H-2 (2 horas antes): LEMBRETE leve com o link/local e o ganho concreto de aparecer. Tom de "te espero", não de cobrança.
- pós-falta (se não compareceu): RESGATE sem culpa — assume que algo aconteceu, reoferece horário, mantém a relação. Nunca passa recibo nem humilha.
Cada item tem CANAL e MENSAGEM pronta.

## COMO USAR O CONTEXTO DO CLIENTE

- Personalize as mensagens com o ICP, o produto, a oferta, o nicho e a identidade/tom fornecidos. Deve soar como a marca do cliente, não genérico.
- Use o contexto pedido para ancorar a referência (o que o lead pediu, qual reunião, qual dia) — quanto mais específico o gancho, maior a taxa de resposta/comparecimento.

## REGRA ANTI-ALUCINAÇÃO (inegociável)

- NÃO invente dados que não foram fornecidos: nome do lead, dia/hora da reunião, link da sala, valor da proposta, prazo. Quando um desses for necessário e não tiver sido dado, use um PLACEHOLDER explícito entre colchetes (ex.: "[NOME DO LEAD]", "[DIA E HORA DA REUNIÃO]", "[LINK DA SALA]", "[VALOR DA PROPOSTA]") em vez de fabricar.
- Não prometa resultado específico que não esteja na oferta. Não invente benefício que o produto não tem.
- Se faltar contexto do cliente (ICP/produto/oferta vazios), escreva mensagens estruturalmente corretas mas marque com placeholders o que precisa ser preenchido — não chute dados do negócio.

Responda SEMPRE chamando a ferramenta. Não escreva texto fora da ferramenta. Idioma: português do Brasil.`;

export const FOLLOWUP_TOOL: Anthropic.Tool = {
  name: "registrar_followup_comparecimento",
  description:
    "Registra a cadência de follow-up (Dia 1/3/7/14) e o kit anti no-show (D-1, H-2, pós-falta), com as mensagens prontas, multicanal, personalizadas para o cliente.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      titulo: {
        type: "string",
        description:
          "Título curto refletindo o contexto (ex.: 'Retomada de lead que pediu proposta e sumiu').",
      },
      cadencia_followup: {
        type: "array",
        description:
          "A cadência de follow-up para o lead que esfriou, nos momentos Dia 1, Dia 3, Dia 7 e Dia 14. Cubra os quatro momentos, na ordem.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            momento: {
              type: "string",
              description: "Momento do toque (ex.: 'Dia 1', 'Dia 3', 'Dia 7', 'Dia 14').",
            },
            canal: {
              type: "string",
              description:
                "Canal do toque (ex.: 'WhatsApp', 'e-mail', 'ligação', 'áudio', 'LinkedIn'). Varie entre os toques.",
            },
            mensagem: {
              type: "string",
              description:
                "A mensagem pronta para enviar, curta e personalizada, com UM call-to-action. Use placeholders [ENTRE COLCHETES] para dados não fornecidos — nunca invente.",
            },
            objetivo: {
              type: "string",
              description:
                "O que este toque precisa conquistar (ex.: 'reabrir a conversa', 'agregar prova', 'criar urgência', 'encerrar com dignidade').",
            },
          },
          required: ["momento", "canal", "mensagem", "objetivo"],
        },
      },
      kit_comparecimento: {
        type: "array",
        description:
          "O kit anti no-show para a reunião agendada, nos momentos D-1 (véspera), H-2 (2h antes) e pós-falta (resgate). Cubra os três momentos, na ordem.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            momento: {
              type: "string",
              description: "Momento (ex.: 'D-1', 'H-2', 'pós-falta').",
            },
            canal: {
              type: "string",
              description: "Canal da mensagem (ex.: 'WhatsApp', 'e-mail', 'ligação').",
            },
            mensagem: {
              type: "string",
              description:
                "A mensagem pronta para enviar. Use placeholders [ENTRE COLCHETES] para dados não fornecidos (dia/hora, link, nome) — nunca invente.",
            },
          },
          required: ["momento", "canal", "mensagem"],
        },
      },
    },
    required: ["titulo", "cadencia_followup", "kit_comparecimento"],
  },
};
