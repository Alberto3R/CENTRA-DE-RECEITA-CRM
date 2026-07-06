// Validação de insumo (etapa de triagem barata com Haiku).
//
// Portado do head comercIAl. Antes de gastar o Sonnet na análise das 7
// dimensões, o Haiku confere se o texto enviado é mesmo uma transcrição de
// conversa comercial analisável — evita "lixo entra, lixo sai" e dá uma
// mensagem clara de como corrigir o insumo.

import type Anthropic from "@anthropic-ai/sdk";

import {
  getAnthropic,
  MODELO_TRIAGEM,
  systemCacheado,
  toolsCacheadas,
  type UsoTokens,
} from "./anthropic";

const VALIDAR_TOOL: Anthropic.Tool = {
  name: "registrar_validacao",
  description:
    "Registra se o material enviado é uma transcrição de call de vendas analisável.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      valido: {
        type: "boolean",
        description:
          "true se é uma transcrição de conversa comercial (com fala de pelo menos 2 pessoas) que dá para analisar.",
      },
      tipo_detectado: {
        type: "string",
        description:
          "O que o material parece ser (ex.: 'transcrição de call', 'conversa de WhatsApp', 'texto avulso', 'documento não relacionado').",
      },
      motivo: {
        type: "string",
        description:
          "Se inválido: por que, e COMO o usuário corrige (ex.: 'exporte a transcrição do Meet em .txt/.vtt'). Se válido: string vazia.",
      },
    },
    required: ["valido", "tipo_detectado", "motivo"],
  },
};

export interface ResultadoValidacao {
  valido: boolean;
  tipo_detectado: string;
  motivo: string;
  uso: UsoTokens;
}

const SYSTEM =
  "Você é um validador de insumo de análise comercial. Recebe o INÍCIO de um material e decide se é uma transcrição de call/conversa de vendas analisável (diálogo entre vendedor e cliente). Seja tolerante a formatos (.txt, .vtt, com ou sem timestamps), mas recuse o que claramente não é uma conversa comercial. Responda SEMPRE pela ferramenta.";

/**
 * Valida o insumo com o modelo de triagem (Haiku). Usa só o início do texto
 * para ser barato. Devolve o veredito + os tokens para a telemetria.
 */
export async function validarInsumo(texto: string): Promise<ResultadoValidacao> {
  const client = getAnthropic();

  const resposta = await client.messages.create({
    model: MODELO_TRIAGEM,
    max_tokens: 400,
    system: systemCacheado(SYSTEM),
    tools: toolsCacheadas([VALIDAR_TOOL]),
    tool_choice: { type: "tool", name: VALIDAR_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Avalie o início deste material:\n\n${texto.slice(0, 4000)}`,
      },
    ],
  });

  const bloco = resposta.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === VALIDAR_TOOL.name,
  );
  if (!bloco) {
    throw new Error("Validação de insumo falhou: o modelo não retornou veredito.");
  }

  const input = bloco.input as {
    valido: boolean;
    tipo_detectado: string;
    motivo: string;
  };

  return {
    valido: input.valido,
    tipo_detectado: input.tipo_detectado,
    motivo: input.motivo,
    uso: {
      modelo: MODELO_TRIAGEM,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}
