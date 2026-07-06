// Motor do agente de IA conversacional.
//
// Chama a Anthropic Messages API com a persona (system prompt configurado
// por marca) + a transcrição da conversa, e devolve a próxima resposta +
// sinais de controle. Portado do bot WhatsApp da Augra (antes no Make):
// mesmo formato de saída JSON
//   {reply, publico, intencao, handoff, handoff_motivo, resumo}
// onde só `reply` vai pro cliente; o resto é interno (CRM).

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export interface AgentConfig {
  system_prompt: string
  model: string
  max_tokens: number
}

export interface AgentTurn {
  /** Cliente vira role "user" na transcrição; agente/bot viram "assistant". */
  fromCustomer: boolean
  text: string
}

export interface AgentReply {
  reply: string
  handoff: boolean
  handoff_motivo: string
  intencao: string
  resumo: string
  publico: string
}

function todayBRT(): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  })
  return fmt.format(new Date())
}

function buildUserMessage(history: AgentTurn[], incoming: string, leadContext?: string): string {
  const transcript = history.length
    ? history.map((t) => `${t.fromCustomer ? 'Cliente' : 'Agente'}: ${t.text}`).join('\n')
    : '(primeiro contato)'
  return [
    `Data de hoje: ${todayBRT()}, fuso America/Sao_Paulo.`,
    ...(leadContext ? ['', leadContext] : []),
    '',
    'Transcrição da conversa até agora:',
    transcript,
    '',
    `Nova mensagem: ${incoming}`,
    '',
    'Estilo da "reply": CURTA — no máximo 2 ou 3 frases, ritmo de WhatsApp, uma ideia por vez. Nada de textão. Para separar ideias em mensagens distintas, use uma linha em branco entre elas.',
    '',
    'Responda com o objeto JSON conforme o FORMATO DE SAÍDA.',
  ].join('\n')
}

function parseReply(text: string): AgentReply {
  // O system prompt manda responder SÓ com JSON. Limpa cercas de código e
  // parseia; se o modelo escapar do formato, usa o texto cru como a resposta.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    const o = JSON.parse(cleaned) as Record<string, unknown>
    return {
      reply: typeof o.reply === 'string' ? o.reply : '',
      handoff: o.handoff === true,
      handoff_motivo: typeof o.handoff_motivo === 'string' ? o.handoff_motivo : '',
      intencao: typeof o.intencao === 'string' ? o.intencao : '',
      resumo: typeof o.resumo === 'string' ? o.resumo : '',
      publico: typeof o.publico === 'string' ? o.publico : '',
    }
  } catch {
    return {
      reply: text.trim(),
      handoff: false,
      handoff_motivo: '',
      intencao: '',
      resumo: '',
      publico: '',
    }
  }
}

/**
 * Roda um turno do agente. Retorna a resposta + sinais, ou null se o
 * agente não puder responder (sem API key, erro de rede, resposta vazia) —
 * o chamador deve, nesse caso, deixar a conversa pro atendimento humano.
 */
export async function runAgent(params: {
  config: AgentConfig
  history: AgentTurn[]
  incomingText: string
  /** Contexto do lead (ex.: dados da calculadora) injetado na mensagem. */
  leadContext?: string
}): Promise<AgentReply | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[ai-agent] ANTHROPIC_API_KEY não configurada — agente inativo')
    return null
  }
  const { config, history, incomingText, leadContext } = params
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.max_tokens,
        system: config.system_prompt,
        messages: [{ role: 'user', content: buildUserMessage(history, incomingText, leadContext) }],
      }),
    })
    if (!res.ok) {
      console.error('[ai-agent] Anthropic API erro', res.status, await res.text())
      return null
    }
    const data = (await res.json()) as { content?: { text?: string }[] }
    const text = data?.content?.[0]?.text ?? ''
    if (!text) return null
    return parseReply(text)
  } catch (err) {
    console.error('[ai-agent] runAgent falhou:', err)
    return null
  }
}
