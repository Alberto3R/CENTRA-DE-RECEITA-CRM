// Agente 3R de acompanhamento — ENVIO do resumo pro gestor via WhatsApp.
// Reusa o padrão do lead-alert.ts: resolve o canal da conta, descriptografa o
// token e dispara o template HSM aprovado `ccc_alerta_gestor` ({{1}} = resumo).

import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'

const TEMPLATE_NAME = 'ccc_alerta_gestor'
const GRAPH = 'https://graph.facebook.com/v22.0'

export async function enviarAlertaGestor(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  gestorWhatsapp: string
  resumo: string
}): Promise<{ ok: boolean; reason?: string }> {
  const { supabase, accountId, gestorWhatsapp, resumo } = params

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

  try {
    const res = await fetch(`${GRAPH}/${wa.phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: gestorWhatsapp,
        type: 'template',
        template: {
          name: TEMPLATE_NAME,
          language: { code: 'pt_BR' },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: resumo }],
            },
          ],
        },
      }),
    })
    if (!res.ok) {
      console.error('[ccc-alerta] erro Meta', res.status, await res.text())
      return { ok: false, reason: `meta_${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[ccc-alerta] fetch falhou', err)
    return { ok: false, reason: 'fetch_failed' }
  }
}
