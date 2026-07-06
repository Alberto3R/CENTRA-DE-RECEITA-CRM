#!/usr/bin/env node
// =============================================================================
// eval-call.mjs — roda o prompt v1 de análise de call contra a Anthropic e
// VALIDA estruturalmente a saída contra a rubrica do golden set.
//
// Portado do head comercIAl. É o GATE de qualidade do módulo de IA do produto
// unificado: mudou prompt → rode este eval verde antes de abrir PR.
//
// USO:
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/golden-set/eval-call.mjs caminho/transcricao.txt
//
// O QUE VALIDA (checks):
//   1. As 7 dimensões (preset 3R) estão TODAS presentes.
//   2. Toda evidência tem timestamp NÃO-VAZIO (regra anti-alucinação).
//   3. Se perda_estimada_reais != null, então perda_memoria_calculo existe.
//
// Sai com código 1 se qualquer check falhar (útil para CI).
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const MODELO_ANALISE = "claude-sonnet-4-6";

const DIMENSOES = [
  "abertura_rapport",
  "qualificacao_fit",
  "spin",
  "apresentacao",
  "preco",
  "objecoes",
  "fechamento_proximos_passos",
];

// Espelha SYSTEM_PROMPT_3R de src/lib/ai/prompts/analise-call-v1.ts (preset 3R).
const SYSTEM_PROMPT = `Você é o head comercial sênior da Sales 3R analisando uma call de vendas B2B.

Avalie SEMPRE as 7 dimensões nesta ordem: abertura_rapport, qualificacao_fit, spin, apresentacao, preco, objecoes, fechamento_proximos_passos.

Para cada ponto relevante, encadeie: EVIDÊNCIA (trecho real + timestamp real [mm:ss] ou [hh:mm:ss], nunca inventado) -> PERDA EM R$ (com memória de cálculo, quando houver dados) -> PRESCRIÇÃO (o que dizer, com exemplo de script).

REGRA ANTI-ALUCINAÇÃO: toda evidência precisa de timestamp que existe na transcrição. Para calcular perda em R$ você precisa de ticket/volume — se esses dados não estão na transcrição, deixe perda_estimada_reais = null, perda_memoria_calculo = null e liste o que faltou em dados_faltantes. NUNCA invente ticket, volume ou perda.

Responda SEMPRE chamando a ferramenta de análise. Idioma: português do Brasil.`;

function dimensaoSchema(dim) {
  return {
    type: "object",
    additionalProperties: false,
    description: `Avaliação da dimensão ${dim}.`,
    properties: {
      score: { type: "integer", minimum: 0, maximum: 10, description: "Nota 0-10." },
      evidencias: {
        type: "array",
        description: "Evidências com timestamp real, trecho e comentário.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            timestamp: { type: "string", description: "Timestamp real, nunca vazio." },
            trecho: { type: "string", description: "Trecho citado." },
            comentario: { type: "string", description: "O que revela." },
          },
          required: ["timestamp", "trecho", "comentario"],
        },
      },
      resumo: { type: "string", description: "Resumo da dimensão." },
    },
    required: ["score", "evidencias", "resumo"],
  };
}

const ANALISE_TOOL = {
  name: "registrar_analise_call",
  description:
    "Registra a análise estruturada de uma call seguindo as 7 dimensões (evidência -> perda em R$ -> prescrição).",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      dimensoes: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(DIMENSOES.map((d) => [d, dimensaoSchema(d)])),
        required: [...DIMENSOES],
      },
      nota: { type: "string", enum: ["A", "B", "C"] },
      perda_estimada_reais: { type: ["number", "null"] },
      perda_memoria_calculo: { type: ["string", "null"] },
      dados_faltantes: { type: "array", items: { type: "string" } },
      prescricoes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            dimensao: { type: "string", enum: [...DIMENSOES] },
            o_que_dizer: { type: "string" },
            exemplo_script: { type: "string" },
          },
          required: ["dimensao", "o_que_dizer", "exemplo_script"],
        },
      },
      proximos_passos: { type: "array", items: { type: "string" } },
      dados_crm: {
        type: "object",
        additionalProperties: false,
        properties: {
          ticket: { type: ["number", "null"] },
          volume: { type: ["number", "null"] },
          publico: { type: ["string", "null"] },
          temperatura: { type: ["string", "null"] },
        },
      },
    },
    required: [
      "dimensoes",
      "nota",
      "perda_estimada_reais",
      "perda_memoria_calculo",
      "dados_faltantes",
      "prescricoes",
      "proximos_passos",
      "dados_crm",
    ],
  },
};

function morrer(msg) {
  console.error(`\n[erro] ${msg}\n`);
  process.exit(2);
}

async function main() {
  const caminhoArg = process.argv[2];
  if (!caminhoArg) {
    morrer(
      "Faltou o caminho da transcrição.\n  Uso: ANTHROPIC_API_KEY=... node scripts/golden-set/eval-call.mjs caminho/transcricao.txt",
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    morrer("ANTHROPIC_API_KEY não definida no ambiente.");
  }

  const caminho = resolve(process.cwd(), caminhoArg);
  let transcricao;
  try {
    transcricao = readFileSync(caminho, "utf8");
  } catch (e) {
    morrer(`Não consegui ler o arquivo: ${caminho}\n  ${e.message}`);
  }
  if (!transcricao.trim()) {
    morrer("Transcrição vazia.");
  }

  console.log(`> Analisando: ${caminho}`);
  console.log(`> Modelo: ${MODELO_ANALISE}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [ANALISE_TOOL],
    tool_choice: { type: "tool", name: ANALISE_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Analise a call abaixo. Transcrição:\n\n${transcricao}`,
      },
    ],
  });

  const bloco = resposta.content.find(
    (b) => b.type === "tool_use" && b.name === ANALISE_TOOL.name,
  );
  if (!bloco) {
    morrer(`O modelo não chamou a tool (stop_reason: ${resposta.stop_reason}).`);
  }

  const analise = bloco.input;

  console.log("===== ANÁLISE (JSON) =====");
  console.log(JSON.stringify(analise, null, 2));
  console.log("==========================\n");

  const resultados = [];
  const check = (nome, ok, detalhe = "") => resultados.push({ nome, ok, detalhe });

  const dims = analise?.dimensoes ?? {};
  for (const dim of DIMENSOES) {
    check(`dimensão presente: ${dim}`, Object.prototype.hasOwnProperty.call(dims, dim));
  }

  let evidenciasTotal = 0;
  let evidenciasSemTs = 0;
  for (const dim of DIMENSOES) {
    const evs = dims?.[dim]?.evidencias ?? [];
    for (const ev of evs) {
      evidenciasTotal++;
      if (!ev || typeof ev.timestamp !== "string" || ev.timestamp.trim() === "") {
        evidenciasSemTs++;
      }
    }
  }
  check(
    "toda evidência tem timestamp não-vazio",
    evidenciasSemTs === 0,
    `${evidenciasTotal} evidência(s), ${evidenciasSemTs} sem timestamp`,
  );

  const perda = analise?.perda_estimada_reais ?? null;
  const memoria = analise?.perda_memoria_calculo ?? null;
  check(
    "perda != null exige memória de cálculo",
    perda === null || (typeof memoria === "string" && memoria.trim() !== ""),
    perda === null
      ? "perda nula (ok, sem dados)"
      : `perda=${perda}, memória ${memoria ? "presente" : "AUSENTE"}`,
  );

  const passed = resultados.filter((r) => r.ok).length;
  const failed = resultados.length - passed;

  console.log("===== CHECKS =====");
  for (const r of resultados) {
    const tag = r.ok ? "PASS" : "FAIL";
    const det = r.detalhe ? ` (${r.detalhe})` : "";
    console.log(`  [${tag}] ${r.nome}${det}`);
  }
  console.log("==================");
  console.log(`\nplacar: ${passed} passed / ${failed} failed`);
  console.log(
    `tokens: in=${resposta.usage.input_tokens} out=${resposta.usage.output_tokens}`,
  );

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => morrer(e?.stack ?? String(e)));
