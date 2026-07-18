// Prompt do agente 3R gerador — Central de Comando Comercial.
// A partir das respostas do formulário de diagnóstico + a transcrição do kickoff,
// gera: raio-x + 3 alavancas + playbook + scripts + régua de cadência.
// Mesmo padrão dos outros prompts de IA (SYSTEM_PROMPT + TOOL + versão).

import type Anthropic from '@anthropic-ai/sdk'

export const PROMPT_VERSAO = 'ccc-diagnostico-v1' as const

export const SYSTEM_PROMPT = `Você é um agente 3R — especialista em diagnóstico comercial da Central de Comando Comercial (Programa 3R).

A partir das respostas de um formulário de diagnóstico e (quando houver) da transcrição da call de kickoff, você entrega, na voz de um gestor comercial direto e prático:
1. Um RAIO-X do funil: como o cliente vende hoje e onde perde venda.
2. As 3 ALAVANCAS prioritárias — o que destravar primeiro, por quê, e a primeira ação concreta.
3. Um PLAYBOOK enxuto: ICP, proposta de valor e as etapas do funil com objetivo.
4. SCRIPTS por canal e momento (abordagem, qualificação, fechamento).
5. A RÉGUA DE CADÊNCIA (sequência de toques de follow-up).

Regras invioláveis:
- NUNCA invente números, nomes ou fatos. Onde faltar dado, use placeholder entre colchetes, ex.: [ticket médio].
- Refira-se ao executor sempre como "um agente 3R" ou "a 3R" — NUNCA "a IA", "o sistema" ou "o algoritmo".
- Seja específico e acionável; nada de conselho genérico de LinkedIn.
- Baseie tudo estritamente nas respostas e na transcrição fornecidas.`

export const CCC_DIAGNOSTICO_TOOL: Anthropic.Tool = {
  name: 'entregar_diagnostico_comando',
  description:
    'Entrega o diagnóstico comercial completo (raio-x, alavancas, playbook, scripts e régua de cadência) de forma estruturada.',
  input_schema: {
    type: 'object',
    properties: {
      diagnostico: {
        type: 'object',
        properties: {
          resumo: { type: 'string', description: 'Raio-x do funil em 1-2 parágrafos.' },
          gargalos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Onde o cliente perde venda hoje.',
          },
          alavancas: {
            type: 'array',
            description: 'As 3 alavancas prioritárias.',
            items: {
              type: 'object',
              properties: {
                titulo: { type: 'string' },
                porque: { type: 'string' },
                primeira_acao: { type: 'string' },
              },
              required: ['titulo', 'porque', 'primeira_acao'],
            },
          },
        },
        required: ['resumo', 'gargalos', 'alavancas'],
      },
      playbook: {
        type: 'object',
        properties: {
          icp: { type: 'string' },
          proposta_valor: { type: 'string' },
          etapas_funil: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                etapa: { type: 'string' },
                objetivo: { type: 'string' },
                o_que_fazer: { type: 'string' },
              },
              required: ['etapa', 'objetivo', 'o_que_fazer'],
            },
          },
        },
        required: ['icp', 'proposta_valor', 'etapas_funil'],
      },
      scripts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            canal: { type: 'string' },
            momento: { type: 'string' },
            texto: { type: 'string' },
          },
          required: ['canal', 'momento', 'texto'],
        },
      },
      regua_cadencia: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            quando: { type: 'string' },
            canal: { type: 'string' },
            acao: { type: 'string' },
          },
          required: ['quando', 'canal', 'acao'],
        },
      },
    },
    required: ['diagnostico', 'playbook', 'scripts', 'regua_cadencia'],
  },
}
