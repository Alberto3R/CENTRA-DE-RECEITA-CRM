// Agente 3R de acompanhamento — ENVIO de WhatsApp (gestor + vendedor).
// Reusa o padrão do lead-alert.ts: resolve o canal da conta, descriptografa o
// token e dispara um template HSM aprovado. Uma função genérica atende tanto o
// resumo do gestor (ccc_alerta_gestor) quanto a cobrança individual
// (ccc_followup_atrasado).

import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveChannelConfig } from '@/lib/whatsapp/channel'

const GRAPH = 'https://graph.facebook.com/v22.0'

export async function enviarTemplate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  to: string
  template: string
  variaveis: string[]
}): Promise<{ ok: boolean; reason?: string }> {
  const { supabase, accountId, to, template, variaveis } = params

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
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: 'pt_BR' },
          components: [
            {
              type: 'body',
              parameters: variaveis.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
    })
    if (!res.ok) {
      console.error('[ccc-alerta] erro Meta', template, res.status, await res.text())
      return { ok: false, reason: `meta_${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error('[ccc-alerta] fetch falhou', err)
    return { ok: false, reason: 'fetch_failed' }
  }
}

/** Resumo pro gestor (template ccc_alerta_gestor, {{1}} = resumo). */
export function enviarAlertaGestor(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  gestorWhatsapp: string
  resumo: string
}) {
  return enviarTemplate({
    supabase: params.supabase,
    accountId: params.accountId,
    to: params.gestorWhatsapp,
    template: 'ccc_alerta_gestor',
    variaveis: [params.resumo],
  })
}

/** Cobrança individual do vendedor (ccc_followup_atrasado, {{1}}=nome {{2}}=qtd). */
export function cobrarVendedor(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  vendedorWhatsapp: string
  vendedorNome: string
  quantidade: number
}) {
  return enviarTemplate({
    supabase: params.supabase,
    accountId: params.accountId,
    to: params.vendedorWhatsapp,
    template: 'ccc_followup_atrasado',
    variaveis: [params.vendedorNome, String(params.quantidade)],
  })
}
