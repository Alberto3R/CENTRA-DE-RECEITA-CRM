// Agente 3R gerador — Central de Comando Comercial.
// Função pura: recebe as respostas do formulário de diagnóstico + a transcrição
// do kickoff, chama o Anthropic com tool_choice forçado, valida com zod e
// devolve { entregaveis, conteudoMd, uso }. NÃO acessa banco — quem persiste é
// o caller (rota /api/diagnostico/gerar). Mesmo padrão de script-comercial.ts.

import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import {
  getAnthropic,
  MODELO_ANALISE,
  systemCacheado,
  toolsCacheadas,
  type UsoTokens,
} from './anthropic'
import {
  CCC_DIAGNOSTICO_TOOL,
  PROMPT_VERSAO,
  SYSTEM_PROMPT,
} from './prompts/ccc-diagnostico-v1'

const alavancaSchema = z.object({
  titulo: z.string(),
  porque: z.string(),
  primeira_acao: z.string(),
})
const etapaSchema = z.object({
  etapa: z.string(),
  objetivo: z.string(),
  o_que_fazer: z.string(),
})
const scriptSchema = z.object({
  canal: z.string(),
  momento: z.string(),
  texto: z.string(),
})
const toqueSchema = z.object({
  quando: z.string(),
  canal: z.string(),
  acao: z.string(),
})

export const diagnosticoComandoSchema = z.object({
  diagnostico: z.object({
    resumo: z.string(),
    gargalos: z.array(z.string()),
    alavancas: z.array(alavancaSchema),
  }),
  playbook: z.object({
    icp: z.string(),
    proposta_valor: z.string(),
    etapas_funil: z.array(etapaSchema),
  }),
  scripts: z.array(scriptSchema),
  regua_cadencia: z.array(toqueSchema),
})

export type DiagnosticoComando = z.infer<typeof diagnosticoComandoSchema>

export interface ResultadoDiagnostico {
  entregaveis: DiagnosticoComando
  /** Markdown montado no servidor (não vem do LLM). */
  conteudoMd: string
  uso: UsoTokens
  promptVersao: typeof PROMPT_VERSAO
}

export async function gerarDiagnosticoComando(args: {
  respostas: Record<string, unknown>
  transcricao?: string
}): Promise<ResultadoDiagnostico> {
  const { respostas, transcricao } = args
  const client = getAnthropic()

  const resposta = await client.messages.create({
    model: MODELO_ANALISE,
    max_tokens: 16000,
    system: systemCacheado(SYSTEM_PROMPT),
    tools: toolsCacheadas([CCC_DIAGNOSTICO_TOOL]),
    tool_choice: { type: 'tool', name: CCC_DIAGNOSTICO_TOOL.name },
    messages: [
      {
        role: 'user',
        content: `Gere o diagnóstico comercial completo com base nos insumos abaixo.

## RESPOSTAS DO FORMULÁRIO DE DIAGNÓSTICO
${JSON.stringify(respostas, null, 2)}

## TRANSCRIÇÃO DA CALL DE KICKOFF
${
  transcricao && transcricao.trim() !== ''
    ? transcricao.trim()
    : '(sem transcrição — baseie-se apenas nas respostas do formulário)'
}

Lembre: não invente dados; use placeholders [entre colchetes] onde faltar. Fale como um agente 3R.`,
      },
    ],
  })

  const toolInput = extrairToolInput(resposta, CCC_DIAGNOSTICO_TOOL.name)
  const entregaveis = diagnosticoComandoSchema.parse(toolInput)

  return {
    entregaveis,
    conteudoMd: montarMarkdown(entregaveis),
    promptVersao: PROMPT_VERSAO,
    uso: {
      modelo: MODELO_ANALISE,
      tokens_in: resposta.usage.input_tokens,
      tokens_out: resposta.usage.output_tokens,
    },
  }
}

/** Monta o markdown dos entregáveis a partir da estrutura — no servidor, sem gastar tokens. */
function montarMarkdown(d: DiagnosticoComando): string {
  const l: string[] = ['# Diagnóstico Comercial 3R', '']
  l.push('## Raio-X do funil', d.diagnostico.resumo, '')
  if (d.diagnostico.gargalos.length > 0) {
    l.push('### Onde você perde venda hoje')
    for (const g of d.diagnostico.gargalos) l.push(`- ${g}`)
    l.push('')
  }
  l.push('## As 3 alavancas prioritárias')
  d.diagnostico.alavancas.forEach((a, i) => {
    l.push(
      `### ${i + 1}. ${a.titulo}`,
      `**Por quê:** ${a.porque}`,
      `**Primeira ação:** ${a.primeira_acao}`,
      '',
    )
  })
  l.push('## Playbook', `**ICP:** ${d.playbook.icp}`, '', `**Proposta de valor:** ${d.playbook.proposta_valor}`, '')
  l.push('### Etapas do funil')
  for (const e of d.playbook.etapas_funil) {
    l.push(`- **${e.etapa}** — ${e.objetivo}. ${e.o_que_fazer}`)
  }
  l.push('')
  if (d.scripts.length > 0) {
    l.push('## Scripts')
    for (const s of d.scripts) l.push(`### ${s.canal} · ${s.momento}`, s.texto, '')
  }
  if (d.regua_cadencia.length > 0) {
    l.push('## Régua de cadência')
    for (const t of d.regua_cadencia) l.push(`- **${t.quando}** (${t.canal}): ${t.acao}`)
  }
  return l.join('\n')
}

function extrairToolInput(resposta: Anthropic.Message, nomeTool: string): unknown {
  const bloco = resposta.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === 'tool_use' && b.name === nomeTool,
  )
  if (!bloco) {
    throw new Error(
      `O agente 3R não retornou a tool "${nomeTool}" (stop_reason: ${resposta.stop_reason}).`,
    )
  }
  return bloco.input
}
