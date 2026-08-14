// Alerta interno de lead qualificado — recria o "ping" que o cenário do
// Make (Funil2 · Captação LP) fazia: quando entra um lead qualificado,
// dispara o template aprovado `sdr3r_lead_qualificado` pro WhatsApp do time.
//
// O template (WABA 3R, APPROVED, pt_BR) tem 2 params no corpo:
//   {{1}} = dados do lead (nome • whatsapp • status • origem)
//   {{2}} = resumo da qualificação (faturamento • consciência • ângulo)

import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'

// Número do time que recebe o alerta (mesmo do cenário do Make).
const TEAM_ALERT_PHONE = '5561982742727'
const TEMPLATE_NAME = 'sdr3r_lead_qualificado'
const GRAPH = 'https://graph.facebook.com/v22.0'

export async function notifyTeamNewLead(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  nome: string
  whatsapp: string
  status: string
  origem?: string | null
  faturamento?: string | null
  awareness?: string | null
  angulo?: string | null
  // Quando informado, substitui o {{2}} inteiro. Serve para funis cujas
  // perguntas não são faturamento/consciência/ângulo (ex.: VSC).
  resumo?: string | null
}): Promise<{ ok: boolean; reason?: string }> {
  const { supabase, accountId } = params

  // WhatsApp da conta de captação — canal primário (multi-canal).
  const wa = await resolveChannelConfig(supabase, accountId)
  if (!wa?.phone_number_id || !wa.access_token) {
    return { ok: false, reason: 'whatsapp_not_configured' }
  }

  let token: string
  try {
    token = decrypt(wa.access_token)
  } catch {
    return { ok: false, reason: 'token_decrypt_failed' }
  }

  const dash = (v?: string | null) => (v && v.trim() ? v.trim() : '—')
  const param1 = `${dash(params.nome)} • ${dash(params.whatsapp)} • ${dash(params.status)} (origem: ${dash(params.origem) === '—' ? 'funil2' : params.origem})`
  const param2 =
    params.resumo && params.resumo.trim()
      ? params.resumo.trim()
      : `Faturamento ${dash(params.faturamento)} • consciência: ${dash(params.awareness)} • ângulo ${dash(params.angulo)}`

  try {
    const res = await fetch(`${GRAPH}/${wa.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: TEAM_ALERT_PHONE,
        type: 'template',
        template: {
          name: TEMPLATE_NAME,
          language: { code: 'pt_BR' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: param1 },
                { type: 'text', text: param2 },
              ],
            },
          ],
        },
      }),
    })
    if (!res.ok) {
      console.error('[lead-alert] erro Meta', res.status, await res.text())
      return { ok: false, reason: `meta_${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[lead-alert] fetch falhou', err)
    return { ok: false, reason: 'fetch_failed' }
  }
}
