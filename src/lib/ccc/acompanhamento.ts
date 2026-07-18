// Agente 3R de Acompanhamento (Sprint 1) — DETECÇÃO de gatilhos.
// Função pura: lê o CRM de uma conta e devolve os alertas (deals parados,
// fechamentos vencidos) agrupados por vendedor, com o WhatsApp de cada um
// (pra cobrança individual). Quem envia e agenda é o caller.

export type TipoAlerta = 'deal_parado' | 'fechamento_vencido'

export interface AlertaAcompanhamento {
  tipo: TipoAlerta
  deal_id: string
  titulo: string
  vendedor_id: string | null
  vendedor_nome: string
  dias: number
  detalhe: string
}

export interface ResumoVendedor {
  vendedor_id: string | null
  vendedor: string
  whatsapp: string | null
  parados: number
  vencidos: number
}

export interface ResumoAcompanhamento {
  account_id: string
  gerado_em: string
  total: number
  por_vendedor: ResumoVendedor[]
  alertas: AlertaAcompanhamento[]
}

function diasDesde(iso: string | null, refMs: number): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((refMs - t) / 86_400_000))
}

export async function detectarGatilhos(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
  diasParado?: number
}): Promise<ResumoAcompanhamento> {
  const { supabase, accountId } = args
  const diasParado = args.diasParado ?? 5
  const agoraMs = Date.now()
  const hojeISO = new Date(agoraMs).toISOString().slice(0, 10)

  // Deals ABERTOS da conta (closed_at nulo).
  const { data: deals } = await supabase
    .from('deals')
    .select('id, title, assigned_to, updated_at, expected_close_date, closed_at')
    .eq('account_id', accountId)
    .is('closed_at', null)

  // Nome do vendedor (assigned_to pode ser o id OU o user_id do profile).
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, user_id, full_name')
    .eq('account_id', accountId)

  const nomePorId = new Map<string, string>()
  for (const p of (profs ?? []) as {
    id?: string
    user_id?: string
    full_name?: string
  }[]) {
    const nome = p.full_name ?? 'Sem nome'
    if (p.id) nomePorId.set(p.id, nome)
    if (p.user_id) nomePorId.set(p.user_id, nome)
  }

  // WhatsApp do vendedor (sellers.linked_user_id = assigned_to).
  const { data: sellers } = await supabase
    .from('sellers')
    .select('linked_user_id, whatsapp, nome')
    .eq('account_id', accountId)

  const whatsappPorId = new Map<string, string>()
  const nomeSellerPorId = new Map<string, string>()
  for (const s of (sellers ?? []) as {
    linked_user_id?: string
    whatsapp?: string
    nome?: string
  }[]) {
    if (s.linked_user_id) {
      if (s.whatsapp) whatsappPorId.set(s.linked_user_id, s.whatsapp)
      if (s.nome) nomeSellerPorId.set(s.linked_user_id, s.nome)
    }
  }

  const nomeDoVendedor = (id: string | null): string =>
    (id ? nomePorId.get(id) ?? nomeSellerPorId.get(id) : undefined) ??
    'Sem responsável'

  const alertas: AlertaAcompanhamento[] = []

  for (const d of (deals ?? []) as {
    id: string
    title: string | null
    assigned_to: string | null
    updated_at: string | null
    expected_close_date: string | null
  }[]) {
    const vendedor_nome = nomeDoVendedor(d.assigned_to)

    if (d.expected_close_date && d.expected_close_date < hojeISO) {
      const dias = diasDesde(d.expected_close_date, agoraMs)
      alertas.push({
        tipo: 'fechamento_vencido',
        deal_id: d.id,
        titulo: d.title ?? 'Sem título',
        vendedor_id: d.assigned_to,
        vendedor_nome,
        dias,
        detalhe: `Fechamento previsto passou há ${dias} dia(s).`,
      })
      continue
    }

    const diasSemMov = diasDesde(d.updated_at, agoraMs)
    if (diasSemMov >= diasParado) {
      alertas.push({
        tipo: 'deal_parado',
        deal_id: d.id,
        titulo: d.title ?? 'Sem título',
        vendedor_id: d.assigned_to,
        vendedor_nome,
        dias: diasSemMov,
        detalhe: `Sem movimento há ${diasSemMov} dia(s).`,
      })
    }
  }

  // Resumo por vendedor (com o WhatsApp de cada um).
  const mapa = new Map<string, ResumoVendedor>()
  for (const a of alertas) {
    const chave = a.vendedor_id ?? '__sem_responsavel__'
    const cur = mapa.get(chave) ?? {
      vendedor_id: a.vendedor_id,
      vendedor: a.vendedor_nome,
      whatsapp: a.vendedor_id ? whatsappPorId.get(a.vendedor_id) ?? null : null,
      parados: 0,
      vencidos: 0,
    }
    if (a.tipo === 'deal_parado') cur.parados++
    else cur.vencidos++
    mapa.set(chave, cur)
  }

  return {
    account_id: accountId,
    gerado_em: new Date(agoraMs).toISOString(),
    total: alertas.length,
    por_vendedor: [...mapa.values()].sort(
      (a, b) => b.parados + b.vencidos - (a.parados + a.vencidos),
    ),
    alertas,
  }
}

/** Monta o texto do resumo que o gestor receberia. */
export function montarResumoGestor(r: ResumoAcompanhamento): string {
  if (r.total === 0) return 'Tudo em dia — nenhum deal parado ou fechamento vencido. 👏'
  const linhas: string[] = [
    `Placar de acompanhamento: ${r.total} ponto(s) de atenção no funil.`,
  ]
  for (const v of r.por_vendedor) {
    const partes: string[] = []
    if (v.parados) partes.push(`${v.parados} parado(s)`)
    if (v.vencidos) partes.push(`${v.vencidos} fechamento(s) vencido(s)`)
    linhas.push(`• ${v.vendedor}: ${partes.join(' · ')}`)
  }
  return linhas.join('\n')
}
