// Disparos que o contato recebeu, reconstruídos como falas do agente.
//
// Existe por causa do incidente de 29/09/2026: o disparo da aula saiu para
// ~560 contatos pelo canal Principal e o worker de broadcast não grava nada
// em `messages` — só em `broadcast_recipients`. Quando as pessoas (e as
// respostas automáticas das lojas) responderam, o agente abriu a conversa
// achando que era contato espontâneo: "o que te motivou a chamar a gente?",
// para gente que NÓS tínhamos chamado 2 minutos antes.
//
// Em vez de criar conversa para todo destinatário de disparo (inundaria a
// caixa de entrada), o agente lê os disparos na hora de responder e os
// intercala no histórico pela data de envio.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveContactField } from '@/lib/broadcast/contact-fields'

const JANELA_DIAS = 14
const MAX_DISPAROS = 6

type VariableMapping = { type: 'static' | 'field' | 'custom_field'; value: string }

export interface OutboundTurn {
  at: string
  text: string
}

// Mesmas regras do worker: só chaves numéricas são variáveis do corpo.
function fillBody(
  body: string,
  variables: Record<string, VariableMapping> | null,
  contact: { name?: string | null; phone?: string | null; email?: string | null; company?: string | null },
  customValues: Map<string, string>,
): string {
  const vars = variables ?? {}
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const v = vars[n]
    if (!v) return '…'
    if (v.type === 'static') return v.value
    if (v.type === 'field') return resolveContactField(v.value, contact) || '…'
    return customValues.get(v.value) || '…'
  })
}

export function formatTemplateTurn(name: string, body: string): string {
  return `[MENSAGEM AUTOMÁTICA QUE NÓS ENVIAMOS — modelo "${name}". Foi a 3R que puxou este contato.]\n${body}`
}

export async function loadOutboundTurns(
  admin: SupabaseClient,
  params: { accountId: string; channelId: string; contactId: string },
): Promise<OutboundTurn[]> {
  const { accountId, channelId, contactId } = params
  try {
    const desde = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000).toISOString()
    const { data: rows } = await admin
      .from('broadcast_recipients')
      .select(
        'sent_at, broadcasts!inner(account_id, channel_id, template_name, template_language, template_variables)',
      )
      .eq('contact_id', contactId)
      .in('status', ['sent', 'delivered', 'read', 'replied'])
      .gte('sent_at', desde)
      .eq('broadcasts.account_id', accountId)
      .order('sent_at', { ascending: false })
      .limit(MAX_DISPAROS * 2)

    type Row = {
      sent_at: string
      broadcasts: {
        channel_id: string | null
        template_name: string
        template_language: string | null
        template_variables: Record<string, VariableMapping> | null
      }
    }
    // Só o que saiu por ESTE canal (null = disparo antigo, anterior ao
    // multicanal, que saía pelo primário — entra como contexto também).
    const disparos = ((rows ?? []) as unknown as Row[])
      .filter((r) => !r.broadcasts.channel_id || r.broadcasts.channel_id === channelId)
      .slice(0, MAX_DISPAROS)
    if (!disparos.length) return []

    const nomes = [...new Set(disparos.map((d) => d.broadcasts.template_name))]
    const [{ data: tpls }, { data: contact }, { data: custom }] = await Promise.all([
      admin
        .from('message_templates')
        .select('name, language, body_text')
        .eq('channel_id', channelId)
        .in('name', nomes),
      admin.from('contacts').select('name, phone, email, company').eq('id', contactId).maybeSingle(),
      admin
        .from('contact_custom_values')
        .select('custom_field_id, value')
        .eq('contact_id', contactId),
    ])
    const bodyOf = new Map(
      ((tpls ?? []) as { name: string; language: string; body_text: string | null }[]).map((t) => [
        `${t.name}|${t.language}`,
        t.body_text ?? '',
      ]),
    )
    const customValues = new Map(
      ((custom ?? []) as { custom_field_id: string; value: string | null }[]).map((c) => [
        c.custom_field_id,
        c.value ?? '',
      ]),
    )

    return disparos.map((d) => {
      const b = d.broadcasts
      const body =
        bodyOf.get(`${b.template_name}|${b.template_language || 'en_US'}`) ||
        [...bodyOf.entries()].find(([k]) => k.startsWith(`${b.template_name}|`))?.[1] ||
        '(texto do modelo indisponível)'
      return {
        at: d.sent_at,
        text: formatTemplateTurn(
          b.template_name,
          fillBody(body, b.template_variables, contact ?? {}, customValues),
        ),
      }
    })
  } catch (e) {
    // Contexto é best-effort: sem ele o agente responde como antes.
    console.error('[ai-agent] disparos do contato indisponíveis:', e)
    return []
  }
}
