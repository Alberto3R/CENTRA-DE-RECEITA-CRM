// Orquestra um turno do agente de IA dentro do webhook de recebimento.
//
// Disparado por processMessage() depois que a mensagem do cliente já foi
// inserida — e SOMENTE quando nenhum flow consumiu a mensagem. Lê a config
// do agente da conta, monta o histórico, chama o motor (respond.ts), envia
// a resposta pelo WhatsApp e grava como mensagem do bot. Lida com handoff
// (por palavra-chave do cliente ou decisão do modelo): marca a conversa e
// para de responder até um humano reabrir.

import type { SupabaseClient } from '@supabase/supabase-js'
import { runAgent, type AgentTurn, type AgentTool, type ToolExecutor } from './respond'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { availableSlots, createMeetEvent, type SchedulingConfig } from '@/lib/google/calendar'

const GRAPH_VERSION = 'v22.0'
const HISTORY_LIMIT = 20

// Ferramentas de agenda Google do agente. Só existem quando a conta conectou a
// agenda e o agendamento está habilitado — aí o agente vê horários livres,
// cria o evento com Meet e manda o link, tudo dentro da conversa.
function buildSchedulingTools(
  accountId: string,
  cfg: SchedulingConfig,
  leadName: string,
  leadEmail: string | null,
): { tools: AgentTool[]; executors: Record<string, ToolExecutor> } {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: cfg.timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const tools: AgentTool[] = [
    {
      name: 'ver_horarios',
      description:
        'Lista os próximos horários livres na agenda do Especialista. Use quando o lead topar a call, ANTES de agendar.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'agendar_call',
      description:
        'Agenda a call com o Especialista num horário livre e gera o link do Google Meet. Passe startISO e endISO EXATAMENTE como vieram de ver_horarios.',
      input_schema: {
        type: 'object',
        properties: { startISO: { type: 'string' }, endISO: { type: 'string' } },
        required: ['startISO', 'endISO'],
        additionalProperties: false,
      },
    },
  ]
  const executors: Record<string, ToolExecutor> = {
    ver_horarios: async () => {
      const slots = await availableSlots(accountId, cfg, 5)
      if (!slots.length) return 'Sem horários livres nos próximos dias. Peça outra preferência ao lead.'
      const lines = slots.map(
        (s, i) => `${i + 1}) ${fmt.format(new Date(s.startISO))} [startISO=${s.startISO} endISO=${s.endISO}]`,
      )
      return (
        'Horários livres:\n' +
        lines.join('\n') +
        '\nPara agendar, chame agendar_call com o startISO e endISO do horário escolhido.'
      )
    },
    agendar_call: async (input) => {
      const startISO = String(input.startISO ?? '')
      const endISO = String(input.endISO ?? '')
      if (!startISO || !endISO) return 'Erro: informe startISO e endISO vindos de ver_horarios.'
      const r = await createMeetEvent(accountId, cfg, {
        startISO,
        endISO,
        summary: `Call — ${leadName}`,
        description: 'Call agendada pelo agente de prospecção via WhatsApp.',
        attendeeEmail: leadEmail,
      })
      if (!r.meetLink) return 'Evento criado, mas sem link do Meet. Confirme com o time.'
      return `Call agendada para ${fmt.format(new Date(startISO))}. Envie ao lead o link do Meet: ${r.meetLink}`
    },
  }
  return { tools, executors }
}

// Monta o bloco de contexto do lead da calculadora (se houver) pra injetar na
// mensagem do agente — assim a IA já chega sabendo a dor, sem perguntar de novo.
function leadContextFrom(raw: Record<string, unknown> | null | undefined): string | undefined {
  if (!raw || raw.origem !== 'calculadora-vaga-aberta') return undefined
  const money = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? 'R$ ' + Math.round(n).toLocaleString('pt-BR') : '—'
  }
  const lines = [
    'CONTEXTO DO LEAD (veio da Calculadora de Vaga Aberta da Augra — já temos estes dados, NÃO pergunte de novo):',
    `- Vaga: ${raw.cargo_vaga ?? '—'}${raw.qtd_vagas_abertas ? ` (×${raw.qtd_vagas_abertas})` : ''}`,
    raw.dias_vaga_aberta != null ? `- Aberta há: ${raw.dias_vaga_aberta} dias` : '',
    raw.salario_anunciado != null ? `- Salário anunciado: ${money(raw.salario_anunciado)}` : '',
    raw.custo_estimado_mensal != null
      ? `- Perda estimada (estimativa de mercado): ${money(raw.custo_estimado_mensal)}/mês`
      : '',
    raw.empresa ? `- Empresa: ${raw.empresa}` : '',
    'Use isso pra personalizar a conversa e conduzir pro diagnóstico/recrutamento.',
  ]
  return lines.filter(Boolean).join('\n')
}

async function sendText(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      },
    )
    if (!res.ok) {
      console.error('[ai-agent] envio falhou', res.status, await res.text())
      return null
    }
    const data = (await res.json()) as { messages?: { id?: string }[] }
    return data?.messages?.[0]?.id ?? null
  } catch (err) {
    console.error('[ai-agent] envio erro', err)
    return null
  }
}

/**
 * Quebra a resposta em mensagens curtas (ritmo de WhatsApp). Separa por
 * linha em branco; limita a 4 balões pra não floodar (o excedente vai
 * junto no último). Sempre devolve ao menos 1 parte.
 */
function splitReply(text: string): string[] {
  const parts = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return [text.trim()]
  if (parts.length <= 4) return parts
  return [...parts.slice(0, 3), parts.slice(3).join('\n\n')]
}

async function insertBotMessage(
  supabase: SupabaseClient,
  conversationId: string,
  text: string,
  metaMessageId: string | null,
): Promise<void> {
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: text,
    message_id: metaMessageId,
    status: 'sent',
  })
}

export async function maybeRunAgent(params: {
  supabase: SupabaseClient
  accountId: string
  conversationId: string
  /** Número do cliente (destino da resposta, no formato wa_id). */
  contactWaId: string
  /** Número da marca (origem do envio). */
  phoneNumberId: string
  /** Canal (whatsapp_config.id) — define QUAL agente responde. */
  channelId: string
  /** Token de acesso da marca, já descriptografado. */
  accessToken: string
  inboundText: string
}): Promise<void> {
  const {
    supabase,
    conversationId,
    contactWaId,
    phoneNumberId,
    channelId,
    accessToken,
    inboundText,
  } = params

  if (!inboundText.trim()) return // v1: responde só a texto

  // 1. Config do agente DO CANAL (multi-agente: 1 persona por número).
  const { data: cfg } = await supabase
    .from('ai_agent_config')
    .select('enabled, system_prompt, model, max_tokens, handoff_keyword, handoff_message')
    .eq('channel_id', channelId)
    .maybeSingle()
  if (!cfg || !cfg.enabled || !cfg.system_prompt?.trim()) return

  // 2. Conversa já em handoff → humano no comando, bot não responde
  const { data: conv } = await supabase
    .from('conversations')
    .select('ai_handoff, contact_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (conv?.ai_handoff) return

  // 3. Handoff por palavra-chave do cliente
  const kw = (cfg.handoff_keyword ?? '').trim().toLowerCase()
  if (kw && inboundText.toLowerCase().includes(kw)) {
    const mid = await sendText(phoneNumberId, accessToken, contactWaId, cfg.handoff_message)
    await insertBotMessage(supabase, conversationId, cfg.handoff_message, mid)
    await supabase
      .from('conversations')
      .update({ ai_handoff: true, status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', conversationId)
    return
  }

  // 4. Histórico (últimas N mensagens com texto, em ordem cronológica)
  const { data: msgs } = await supabase
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  const ordered = (msgs ?? []).slice().reverse()
  // A mensagem nova já foi inserida — remove do histórico pra não duplicar
  // (ela vai separada em incomingText).
  const last = ordered[ordered.length - 1]
  if (last && last.sender_type === 'customer' && last.content_text === inboundText) {
    ordered.pop()
  }
  const history: AgentTurn[] = ordered.map((m) => ({
    fromCustomer: m.sender_type === 'customer',
    text: m.content_text as string,
  }))

  // 4b. Contexto do lead (dados da calculadora) — se o contato tiver atribuição
  //     dessa origem, injeta na mensagem do agente. Silencioso se não houver.
  let leadContext: string | undefined
  const contactId = (conv as { contact_id?: string } | null)?.contact_id
  if (contactId) {
    const { data: attr } = await supabase
      .from('lead_attribution')
      .select('raw')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    leadContext = leadContextFrom(
      (attr as { raw?: Record<string, unknown> } | null)?.raw,
    )
  }

  // 4c. Ferramentas de agenda (se a conta conectou o Google e habilitou o
  //     agendamento). Silencioso se não houver — o agente segue sem ferramentas.
  let tools: AgentTool[] | undefined
  let toolExecutors: Record<string, ToolExecutor> | undefined
  let systemPrompt = cfg.system_prompt
  try {
    const admin = supabaseAdmin()
    const [{ data: gconn }, { data: sched }] = await Promise.all([
      admin.from('google_connections').select('account_id').eq('account_id', params.accountId).maybeSingle(),
      admin
        .from('scheduling_config')
        .select('enabled, timezone, slot_minutes, buffer_minutes, advance_days, business_hours')
        .eq('account_id', params.accountId)
        .maybeSingle(),
    ])
    if (gconn && (sched?.enabled ?? true)) {
      const schedCfg: SchedulingConfig = {
        timezone: sched?.timezone ?? 'America/Sao_Paulo',
        slot_minutes: sched?.slot_minutes ?? 20,
        buffer_minutes: sched?.buffer_minutes ?? 10,
        advance_days: sched?.advance_days ?? 7,
        business_hours: sched?.business_hours ?? { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
      }
      let leadName = 'Lead'
      let leadEmail: string | null = null
      if (contactId) {
        const { data: c } = await admin
          .from('contacts')
          .select('name, email')
          .eq('id', contactId)
          .maybeSingle()
        leadName = (c?.name as string) || 'Lead'
        leadEmail = (c?.email as string) ?? null
      }
      const built = buildSchedulingTools(params.accountId, schedCfg, leadName, leadEmail)
      tools = built.tools
      toolExecutors = built.executors
      systemPrompt +=
        '\n\n# AGENDA (ferramentas)\nVocê PODE marcar a call sozinho. Quando o lead topar e der (ou aceitar) um horário, chame `ver_horarios`, escolha um slot livre e chame `agendar_call` com o startISO/endISO — depois mande a mensagem confirmando com o link do Meet. Não faça handoff humano só para marcar; o handoff fica só para casos fora do escopo.'
    }
  } catch (e) {
    console.error('[ai-agent] tools de agenda indisponíveis:', e)
  }

  // 5. Roda o agente
  const result = await runAgent({
    config: {
      system_prompt: systemPrompt,
      model: cfg.model,
      max_tokens: cfg.max_tokens,
    },
    history,
    incomingText: inboundText,
    leadContext,
    tools,
    toolExecutors,
  })
  if (!result || !result.reply.trim()) {
    // Falha da IA (erro de API, parse inválido ou resposta vazia): em vez
    // de deixar o lead no silêncio, escalamos pra humano — pausa a IA e
    // marca a conversa como pendente. A mensagem do cliente já está no
    // inbox, então fica visível aguardando atendimento manual.
    await supabase
      .from('conversations')
      .update({ ai_handoff: true, status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', conversationId)
    console.error('[ai-agent] sem resposta da IA — conversa', conversationId, 'escalada pra humano')
    return
  }

  // 6. Envia a resposta — quebrada em mensagens curtas (ritmo de WhatsApp),
  // cada balão gravado como mensagem do bot.
  const parts = splitReply(result.reply)
  for (const part of parts) {
    const mid = await sendText(phoneNumberId, accessToken, contactWaId, part)
    await insertBotMessage(supabase, conversationId, part, mid)
  }
  await supabase
    .from('conversations')
    .update({
      last_message_text: parts[parts.length - 1],
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // 7. Handoff decidido pelo modelo → para de responder, espera humano
      ...(result.handoff ? { ai_handoff: true, status: 'pending' } : {}),
    })
    .eq('id', conversationId)
}
