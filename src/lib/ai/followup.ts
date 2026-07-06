// CRIA — FOLLOW-UP & COMPARECIMENTO (anti no-show). Função pura: gera a cadência
// de retomada + o kit anti no-show. NÃO acessa banco. Portado do head comercIAl.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  getAnthropic,
  MODELO_ANALISE,
  systemCacheado,
  toolsCacheadas,
  type UsoTokens,
} from "./anthropic";
import type { ContextoComercial } from "./script-comercial";
import {
  FOLLOWUP_TOOL,
  PROMPT_VERSAO,
  SYSTEM_PROMPT,
} from "./prompts/followup-v1";

const passoFollowupSchema = z.object({
  momento: z.string().min(1),
  canal: z.string().min(1),
  mensagem: z.string().min(1),
  objetivo: z.string().min(1),
});

const passoComparecimentoSchema = z.object({
  momento: z.string().min(1),
  canal: z.string().min(1),
  mensagem: z.string().min(1),
});

export const followupComparecimentoSchema = z.object({
  titulo: z.string().min(1, "titulo não pode ser vazio"),
  cadencia_followup: z
    .array(passoFollowupSchema)
    .min(1, "a cadência precisa de ao menos 1 toque"),
  kit_comparecimento: z
    .array(passoComparecimentoSchema)
    .min(1, "o kit anti no-show precisa de ao menos 1 mensagem"),
});

export type FollowupComparecimento = z.infer<typeof followupComparecimentoSchema>;

export interface ResultadoFollowup {
  resultado: FollowupComparecimento;
  cadenciaMd: string;
  comparecimentoMd: string;
  uso: UsoTokens;
  promptVersao: typeof PROMPT_VERSAO;
}

export async function gerarFollowup(args: {
  contexto?: string;
  contextoComercial: ContextoComercial;
}): Promise<ResultadoFollowup> {
  const { contexto, contextoComercial } = args;
  const client = getAnthropic();

  const contextoCliente = montarContextoCliente(contextoComercial);
  const pedido =
    contexto && contexto.trim() !== ""
      ? contexto.trim()
      : "Cadência de retomada e kit anti no-show padrão da operação (use o ICP/produto/oferta do cliente para definir o cenário mais provável).";

  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 16000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([FOLLOWUP_TOOL]),
    tool_choice: { type: "tool", name: FOLLOWUP_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Monte as DUAS entregas — (1) a cadência de follow-up nos momentos Dia 1, Dia 3, Dia 7 e Dia 14; (2) o kit anti no-show nos momentos D-1, H-2 e pós-falta — para a operação abaixo.

## CONTEXTO PEDIDO
${pedido}

## CONFIGURAÇÃO DO CLIENTE
${contextoCliente}

Lembre: personalize as mensagens com o ICP/produto/oferta/nicho/identidade acima. Onde faltar um dado (nome do lead, dia/hora, link da sala, valor), use placeholder entre colchetes — NÃO invente.`,
      },
    ],
  });

  const toolInput = extrairToolInput(resposta, FOLLOWUP_TOOL.name);
  const resultado = followupComparecimentoSchema.parse(toolInput);

  return {
    resultado,
    cadenciaMd: montarMarkdownCadencia(resultado),
    comparecimentoMd: montarMarkdownKit(resultado),
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}

export function montarMarkdownCadencia(r: FollowupComparecimento): string {
  const l: string[] = [`# ${r.titulo} — Cadência de follow-up`, ``];
  for (const p of r.cadencia_followup) {
    l.push(`## ${p.momento} · ${p.canal}`);
    l.push(`**Objetivo:** ${p.objetivo}`, ``, p.mensagem, ``);
  }
  return l.join("\n");
}

export function montarMarkdownKit(r: FollowupComparecimento): string {
  const l: string[] = [`# ${r.titulo} — Kit anti no-show`, ``];
  for (const p of r.kit_comparecimento) {
    l.push(`## ${p.momento} · ${p.canal}`);
    l.push(p.mensagem, ``);
  }
  return l.join("\n");
}

function montarContextoCliente(s: ContextoComercial): string {
  const fmt = (rotulo: string, valor: unknown): string => {
    if (valor === null || valor === undefined || valor === "") {
      return `- ${rotulo}: (não informado)`;
    }
    const texto =
      typeof valor === "string" ? valor : JSON.stringify(valor, null, 2);
    return `- ${rotulo}:\n${texto}`;
  };
  return [
    fmt("ICP (perfil de cliente ideal)", s.icp),
    fmt("Produto", s.produto),
    fmt("Oferta", s.oferta),
    fmt("Nicho", s.nicho),
    fmt("Identidade / tom de voz", s.identidade),
  ].join("\n");
}

function extrairToolInput(resposta: Anthropic.Message, nomeTool: string): unknown {
  const bloco = resposta.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === nomeTool,
  );
  if (!bloco) {
    throw new Error(
      `O modelo não chamou a tool "${nomeTool}" (stop_reason: ${resposta.stop_reason}). Resposta inesperada do gerador de follow-up.`,
    );
  }
  return bloco.input;
}
