// Módulo CRIA — criador de scripts comerciais. Função pura: recebe o contexto
// opcional do usuário + as configs do cliente (account_sales_config), chama o
// Anthropic com tool_choice forçado, valida com zod e devolve { script, uso }.
// NÃO acessa banco — quem persiste é o caller. Portado do head comercIAl.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  getAnthropic,
  MODELO_ANALISE,
  systemCacheado,
  toolsCacheadas,
  type UsoTokens,
} from "./anthropic";
import {
  ETAPAS,
  ETAPAS_LABEL,
  PROMPT_VERSAO,
  SCRIPT_TOOL,
  SYSTEM_PROMPT,
} from "./prompts/script-comercial-v1";

const etapaSchema = z.object({
  etapa: z.enum(ETAPAS),
  objetivo: z.string(),
  fala_sugerida: z.string(),
  perguntas_chave: z.array(z.string()),
  observacao: z.string(),
});

export const scriptComercialSchema = z.object({
  titulo: z.string().min(1, "titulo não pode ser vazio"),
  canal: z.string().min(1, "canal não pode ser vazio"),
  etapas: z.array(etapaSchema).min(1, "o script precisa de ao menos 1 etapa"),
  regras_de_ouro: z.array(z.string()),
});

export type ScriptComercial = z.infer<typeof scriptComercialSchema>;

/** Configuração do cliente (de account_sales_config). Todos os campos opcionais. */
export interface ContextoComercial {
  icp?: unknown;
  produto?: unknown;
  oferta?: unknown;
  nicho?: string | null;
  identidade?: unknown;
}

export interface ResultadoScript {
  script: ScriptComercial;
  /** Markdown do script montado no SERVIDOR (não vem do LLM — corta latência). */
  conteudoMd: string;
  uso: UsoTokens;
  promptVersao: typeof PROMPT_VERSAO;
}

export async function gerarScriptComercial(args: {
  contexto?: string;
  contextoComercial: ContextoComercial;
}): Promise<ResultadoScript> {
  const { contexto, contextoComercial } = args;
  const client = getAnthropic();

  const contextoCliente = montarContextoCliente(contextoComercial);
  const pedido =
    contexto && contexto.trim() !== ""
      ? contexto.trim()
      : "Script comercial padrão da operação (use o ICP/produto/oferta do cliente para definir o cenário mais provável).";

  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 16000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([SCRIPT_TOOL]),
    tool_choice: { type: "tool", name: SCRIPT_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Monte um script comercial completo (as 9 etapas) para a operação abaixo.

## CONTEXTO PEDIDO
${pedido}

## CONFIGURAÇÃO DO CLIENTE
${contextoCliente}

Lembre: personalize as falas com o ICP/produto/oferta/nicho/identidade acima. Onde faltar um dado (preço, prazo, número), use placeholder entre colchetes — NÃO invente.`,
      },
    ],
  });

  const toolInput = extrairToolInput(resposta, SCRIPT_TOOL.name);
  const script = scriptComercialSchema.parse(toolInput);

  return {
    script,
    conteudoMd: montarMarkdown(script),
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}

/** Monta o markdown do script a partir da estrutura — no servidor, sem gastar tokens. */
function montarMarkdown(s: ScriptComercial): string {
  const l: string[] = [`# ${s.titulo}`, ``, `_Canal: ${s.canal}_`, ``];
  for (const et of s.etapas) {
    l.push(`## ${ETAPAS_LABEL[et.etapa] ?? et.etapa}`);
    l.push(`**Objetivo:** ${et.objetivo}`, ``, et.fala_sugerida, ``);
    if (et.perguntas_chave.length > 0) {
      for (const q of et.perguntas_chave) l.push(`- ${q}`);
      l.push(``);
    }
    if (et.observacao) l.push(`> Tática: ${et.observacao}`, ``);
  }
  if (s.regras_de_ouro.length > 0) {
    l.push(`## Regras de ouro`);
    for (const r of s.regras_de_ouro) l.push(`- ${r}`);
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
      `O modelo não chamou a tool "${nomeTool}" (stop_reason: ${resposta.stop_reason}). Resposta inesperada do criador de scripts.`,
    );
  }
  return bloco.input;
}
