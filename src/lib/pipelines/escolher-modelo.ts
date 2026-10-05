import { getAnthropic, MODELO_TRIAGEM } from '@/lib/ai/anthropic'

import { MODELO_PADRAO_ID, MODELOS, modeloPorId } from './modelos'

// Um agente 3R escolhe, a partir do diagnóstico do cliente, qual modelo da
// biblioteca serve para o funil dele. Antes, o setup da Central de Comando
// criava sempre as mesmas 6 etapas genéricas — no caso da loja de móveis, as
// etapas tiveram de ser trocadas à mão depois.
//
// Triagem barata (Haiku) com saída presa a um enum dos ids da biblioteca:
// não há como o modelo inventar um funil. Qualquer falha cai no padrão.

export interface EscolhaModelo {
  modeloId: string
  motivo: string
  /** true quando não deu para consultar a IA e caiu no modelo padrão. */
  fallback: boolean
}

const TOOL = {
  name: 'escolher_modelo_funil',
  description: 'Escolhe o modelo de funil de vendas da biblioteca que mais se parece com o negócio do cliente.',
  input_schema: {
    type: 'object' as const,
    properties: {
      modelo_id: { type: 'string', enum: MODELOS.map((m) => m.id) },
      motivo: { type: 'string', description: 'Uma frase: por que este modelo, em português.' },
    },
    required: ['modelo_id', 'motivo'],
  },
}

export async function escolherModelo(args: {
  respostas: Record<string, unknown>
  transcricao?: string
}): Promise<EscolhaModelo> {
  const padrao: EscolhaModelo = { modeloId: MODELO_PADRAO_ID, motivo: 'Modelo padrão.', fallback: true }
  try {
    const catalogo = MODELOS.map(
      (m) => `- ${m.id}: ${m.nome} — ${m.paraQuem} Etapas: ${m.etapas.map((e) => e.nome).join(' → ')}`,
    ).join('\n')
    const resposta = await getAnthropic().messages.create({
      model: MODELO_TRIAGEM,
      max_tokens: 400,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [
        {
          role: 'user',
          content: `Você monta o CRM de um cliente da 3R. Escolha o modelo de funil que mais combina com o jeito que ESTE negócio vende — o que importa é o passo de compromisso (visita, reunião, avaliação, test drive, checkout) e o ciclo de venda. Na dúvida entre dois, prefira o mais específico; "geral-3r" só se nenhum segmento servir.

## Modelos
${catalogo}

## Respostas do diagnóstico
${JSON.stringify(args.respostas, null, 2)}

## Trecho da call
${(args.transcricao ?? '').slice(0, 6000) || '(sem transcrição)'}`,
        },
      ],
    })
    const bloco = resposta.content.find((c) => c.type === 'tool_use')
    const input = (bloco && 'input' in bloco ? bloco.input : null) as
      | { modelo_id?: string; motivo?: string }
      | null
    if (!input?.modelo_id || !modeloPorId(input.modelo_id)) return padrao
    return { modeloId: input.modelo_id, motivo: input.motivo ?? '', fallback: false }
  } catch (e) {
    console.error('[escolher-modelo] falhou, usando o padrão:', e)
    return padrao
  }
}
