// Responde uma dúvida de uso do CRM com base nos artigos da Central de Ajuda.
// Função pura sobre a base: recebe a conversa, devolve resposta + artigos.

import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic, MODELO_TRIAGEM, systemCacheado, type UsoTokens } from "@/lib/ai/anthropic";
import { buscarArtigos, carregarArtigos, linkArtigo, type ArtigoAjuda } from "./base";

export interface MensagemChat {
  papel: "usuario" | "ajuda";
  texto: string;
}

export interface RespostaAjuda {
  resposta: string;
  artigos: { slug: string; titulo: string; url: string }[];
  encontrou: boolean;
  uso: UsoTokens;
}

const SYSTEM = `Você é o suporte da Central de Receita, um CRM de vendas com WhatsApp. Responde dúvidas de uso e configuração da plataforma para donos de empresa, gestores e vendedores.

REGRAS
- Responda SÓ com base nos ARTIGOS da Central de Ajuda enviados na mensagem e no CATÁLOGO abaixo. Não invente botão, tela, preço, prazo ou recurso que não esteja neles.
- Se os artigos não respondem a pergunta, diga isso em uma frase e oriente falar com o suporte pelo botão "Falar com o suporte". Nesse caso, "encontrou" = false.
- Português do Brasil, "você", direto e curto: no máximo 8 linhas. Para tarefas, dê os passos numerados (1., 2., 3.) com os rótulos exatos da tela em **negrito**.
- Chame o atendente automático de "agente 3R". Nunca use travessão (— ou –).
- Não cole links no texto: os links dos artigos aparecem como botões abaixo da sua resposta. Você escolhe quais em "artigos" (1 a 3 slugs do CATÁLOGO, o mais útil primeiro).
- Se o texto completo do artigo certo não veio na mensagem mas o CATÁLOGO tem um artigo que trata do assunto, responda em 1 ou 2 frases com o que o título e o resumo dizem, recomende esse artigo e mantenha "encontrou" = true.
- Se a pessoa só cumprimentar, cumprimente e pergunte em que pode ajudar, com "artigos" vazio.

Responda sempre chamando a ferramenta "responder".`;

const TOOL: Anthropic.Tool = {
  name: "responder",
  description: "Entrega a resposta para a pessoa e os artigos de passo a passo recomendados.",
  input_schema: {
    type: "object",
    properties: {
      resposta: { type: "string", description: "Texto da resposta, em markdown simples." },
      artigos: {
        type: "array",
        items: { type: "string" },
        description: "Slugs dos artigos recomendados, do mais útil para o menos útil (máx. 3).",
      },
      encontrou: {
        type: "boolean",
        description: "false quando os artigos não respondem a pergunta.",
      },
    },
    required: ["resposta", "artigos", "encontrou"],
  },
};

function blocoArtigos(artigos: ArtigoAjuda[]): string {
  if (!artigos.length) return "(nenhum artigo encontrado para esta pergunta)";
  return artigos
    .map(
      (a) =>
        `<artigo slug="${a.slug}" categoria="${a.categoria}" quem_ve="${a.quem}">\n# ${a.titulo}\n${a.resumo}\n${a.texto.slice(0, 3500)}\n</artigo>`,
    )
    .join("\n\n");
}

/** Catálogo (slug · título · resumo) de todos os artigos: vai no system, em cache. */
function catalogo(base: ArtigoAjuda[]): string {
  return base.map((a) => `${a.slug} · ${a.titulo} · ${a.resumo}`).join("\n");
}

export async function responderDuvida(conversa: MensagemChat[]): Promise<RespostaAjuda> {
  const base = await carregarArtigos();
  const ultimas = conversa.slice(-8);
  const pergunta = ultimas.filter((m) => m.papel === "usuario").at(-1)?.texto ?? "";
  // Busca pela pergunta atual e, para perguntas de seguimento curtas ("e no
  // celular?"), também pela anterior.
  const anteriores = ultimas.filter((m) => m.papel === "usuario").slice(-2).map((m) => m.texto).join(" ");
  const achados = buscarArtigos(base, pergunta, 5);
  for (const a of buscarArtigos(base, anteriores, 3)) {
    if (!achados.some((x) => x.slug === a.slug)) achados.push(a);
  }

  const historico = ultimas
    .slice(0, -1)
    .map((m) => `${m.papel === "usuario" ? "Pessoa" : "Suporte"}: ${m.texto}`)
    .join("\n");

  const msg = await getAnthropic().messages.create({
    model: MODELO_TRIAGEM,
    max_tokens: 900,
    system: systemCacheado(`${SYSTEM}\n\nCATÁLOGO DA CENTRAL DE AJUDA (slug · título · resumo):\n${catalogo(base)}`),
    tools: [TOOL],
    tool_choice: { type: "tool", name: "responder" },
    messages: [
      {
        role: "user",
        content: `ARTIGOS DA CENTRAL DE AJUDA:\n${blocoArtigos(achados)}\n\n${
          historico ? `CONVERSA ATÉ AGORA:\n${historico}\n\n` : ""
        }PERGUNTA:\n${pergunta}`,
      },
    ],
  });

  const uso: UsoTokens = {
    modelo: MODELO_TRIAGEM,
    tokens_in: msg.usage.input_tokens,
    tokens_out: msg.usage.output_tokens,
  };
  const bloco = msg.content.find((b) => b.type === "tool_use");
  const entrada = (bloco && bloco.type === "tool_use" ? bloco.input : {}) as {
    resposta?: string;
    artigos?: string[];
    encontrou?: boolean;
  };

  const porSlug = new Map(base.map((a) => [a.slug, a]));
  const artigos = (entrada.artigos ?? [])
    .map((s) => porSlug.get(s))
    .filter((a): a is ArtigoAjuda => Boolean(a))
    .slice(0, 3)
    .map((a) => ({ slug: a.slug, titulo: a.titulo, url: linkArtigo(a.slug) }));

  return {
    resposta: (entrada.resposta ?? "").replace(/[—–]/g, ",").trim() ||
      "Não consegui montar a resposta agora. Tente de novo em instantes.",
    artigos,
    encontrou: entrada.encontrou !== false,
    uso,
  };
}
