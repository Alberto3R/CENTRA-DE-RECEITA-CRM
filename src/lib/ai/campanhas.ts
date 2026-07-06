// CRIA — CRIADOR DE CAMPANHAS. Função pura: gera a campanha (gamificação ou
// oferta). NÃO acessa banco. Portado do head comercIAl.

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
  CAMPANHA_TOOL,
  FUNCAO_LABEL,
  FUNCOES,
  PROMPT_VERSAO,
  SYSTEM_PROMPT,
  TIPOS,
  TIPO_LABEL,
  type TipoCampanha,
} from "./prompts/campanhas-v1";

const pontuacaoFuncaoSchema = z.object({
  funcao: z.enum(FUNCOES),
  regras: z.array(z.string()),
});

const calendarioMarcoSchema = z.object({
  marco: z.string(),
  quando: z.string(),
  descricao: z.string(),
});

const mecanicaSchema = z.object({
  regras: z.array(z.string()),
  pontuacao_por_funcao: z.array(pontuacaoFuncaoSchema),
  premiacao: z.array(z.string()),
  calendario: z.array(calendarioMarcoSchema),
});

const materialSchema = z.object({
  canal: z.string(),
  peca: z.string(),
  conteudo: z.string(),
});

export const campanhaSchema = z.object({
  titulo: z.string().min(1, "titulo não pode ser vazio"),
  tipo: z.enum(TIPOS),
  mecanica: mecanicaSchema,
  materiais: z
    .array(materialSchema)
    .min(1, "a campanha precisa de ao menos 1 material"),
});

export type Campanha = z.infer<typeof campanhaSchema>;

export interface ResultadoCampanha {
  campanha: Campanha;
  materiaisMd: string;
  uso: UsoTokens;
  promptVersao: typeof PROMPT_VERSAO;
}

export async function gerarCampanha(args: {
  tipo: TipoCampanha;
  contexto?: string;
  contextoComercial: ContextoComercial;
}): Promise<ResultadoCampanha> {
  const { tipo, contexto, contextoComercial } = args;
  const client = getAnthropic();

  const contextoCliente = montarContextoCliente(contextoComercial);
  const pedido =
    contexto && contexto.trim() !== ""
      ? contexto.trim()
      : "Campanha padrão da operação (use o ICP/produto/oferta do cliente para dimensionar meta, período e mecânica mais prováveis).";

  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 16000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([CAMPANHA_TOOL]),
    tool_choice: { type: "tool", name: CAMPANHA_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Monte uma CAMPANHA COMERCIAL do tipo "${TIPO_LABEL[tipo]}" (tipo=${tipo}) para a operação abaixo.

## CONTEXTO PEDIDO (meta, período, tamanho do time, etc.)
${pedido}

## CONFIGURAÇÃO DO CLIENTE
${contextoCliente}

Lembre: o campo "tipo" da ferramenta DEVE ser "${tipo}". Personalize com o ICP/produto/oferta/nicho/identidade acima. Onde faltar um dado (meta, valor de prêmio, prazo, número), use placeholder entre colchetes — NÃO invente.`,
      },
    ],
  });

  const toolInput = extrairToolInput(resposta, CAMPANHA_TOOL.name);
  const campanha = campanhaSchema.parse(toolInput);

  return {
    campanha,
    materiaisMd: montarMarkdown(campanha),
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  };
}

function montarMarkdown(c: Campanha): string {
  const l: string[] = [`# ${c.titulo}`, ``, `_Tipo: ${TIPO_LABEL[c.tipo]}_`, ``];
  const m = c.mecanica;
  if (m.regras.length > 0) {
    l.push(c.tipo === "oferta" ? `## Big idea, premissas e avatar` : `## Regras`);
    for (const r of m.regras) l.push(`- ${r}`);
    l.push(``);
  }
  if (m.pontuacao_por_funcao.length > 0) {
    l.push(`## Pontuação por função`);
    for (const p of m.pontuacao_por_funcao) {
      l.push(`### ${FUNCAO_LABEL[p.funcao]}`);
      for (const r of p.regras) l.push(`- ${r}`);
      l.push(``);
    }
  }
  if (m.premiacao.length > 0) {
    l.push(`## Premiação`);
    for (const p of m.premiacao) l.push(`- ${p}`);
    l.push(``);
  }
  if (m.calendario.length > 0) {
    l.push(`## Calendário`);
    for (const c2 of m.calendario) {
      l.push(`- **${c2.marco}** (${c2.quando}): ${c2.descricao}`);
    }
    l.push(``);
  }
  if (c.materiais.length > 0) {
    l.push(`## Materiais de comunicação`);
    for (const mat of c.materiais) {
      l.push(`### ${mat.peca} — ${mat.canal}`);
      l.push(mat.conteudo, ``);
    }
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
      `O modelo não chamou a tool "${nomeTool}" (stop_reason: ${resposta.stop_reason}). Resposta inesperada do criador de campanhas.`,
    );
  }
  return bloco.input;
}
