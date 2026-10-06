// Eventos lógicos do webhook de gateway (Voomp + Hotmart) e a sugestão de
// etapa pela FUNÇÃO de cada etapa (migration 103). Cada evento lógico grava
// as chaves dos dois provedores — o endpoint casa a que chegar.

import type { FuncaoEtapa } from './funcoes'

export const ALIASES_GATEWAY = {
  compra: ['salePaid', 'saleApproved', 'paid', 'PURCHASE_APPROVED', 'PURCHASE_COMPLETE'],
  abandono: ['checkoutAbandoned', 'abandonedCart', 'abandonedCheckout', 'saleAbandonedCart', 'PURCHASE_OUT_OF_SHOPPING_CART'],
  recuperacao: ['waiting_payment', 'pixGenerated', 'pixCreated', 'PURCHASE_BILLET_PRINTED', 'PURCHASE_DELAYED'],
  refund: ['saleRefunded', 'saleChargeback', 'refunded', 'chargedback', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_PROTEST'],
} as const

export type EventoGateway = keyof typeof ALIASES_GATEWAY

interface EtapaLite {
  id: string
  position: number
  funcao?: FuncaoEtapa | string | null
}

/**
 * Mapa sugerido ao escolher o funil: compra → primeira etapa de ganho;
 * carrinho abandonado e pix/boleto pendente → primeira etapa de entrada;
 * reembolso marca o negócio como perdido. Evento sem etapa da função fica
 * sem mapa (o admin escolhe à mão).
 */
export function sugerirMapaGateway(etapas: EtapaLite[]): Record<string, string> {
  const ordenadas = [...etapas].sort((a, b) => a.position - b.position)
  const primeira = (f: FuncaoEtapa) => ordenadas.find((e) => e.funcao === f)?.id
  const ganho = primeira('ganho')
  const entrada = primeira('entrada')
  const mapa: Record<string, string> = {}
  if (ganho) for (const k of ALIASES_GATEWAY.compra) mapa[k] = ganho
  if (entrada) {
    for (const k of ALIASES_GATEWAY.abandono) mapa[k] = entrada
    for (const k of ALIASES_GATEWAY.recuperacao) mapa[k] = entrada
  }
  for (const k of ALIASES_GATEWAY.refund) mapa[k] = 'refund'
  return mapa
}
