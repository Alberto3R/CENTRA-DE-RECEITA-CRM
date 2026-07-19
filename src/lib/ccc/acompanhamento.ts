// Agente 3R de Acompanhamento — DETECÇÃO de gatilhos.
// Duas frentes, ambas puras (leem o CRM de uma conta e devolvem o que cobrar;
// quem envia/loga é o caller):
//   1. detectarGatilhos  — deals parados + fechamentos vencidos (gestão por exceção).
//   2. detectarCadencia  — os toques D+N da régua APROVADA que já venceram por
//      negócio (o motor de cadência), usando o marco de entrada em etapa.

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

// Resolve nome e WhatsApp do vendedor a partir de qualquer id (profile.id OU
// user_id). CORRIGE o descasamento: deals.assigned_to = profiles.id, mas
// sellers.linked_user_id = user_id — mapeamos o WhatsApp/nome pelos DOIS.
interface Resolvedor {
  nome: (id: string | null) => string
  whatsapp: (id: string | null) => string | null
}

async function resolverVendedores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
): Promise<Resolvedor> {
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, user_id, full_name')
    .eq('account_id', accountId)

  const nomePorId = new Map<string, string>()
  const profileIdPorUserId = new Map<string, string>()
  for (const p of (profs ?? []) as {
    id?: string
    user_id?: string
    full_name?: string
  }[]) {
    const nome = p.full_name ?? 'Sem nome'
    if (p.id) nomePorId.set(p.id, nome)
    if (p.user_id) nomePorId.set(p.user_id, nome)
    if (p.user_id && p.id) profileIdPorUserId.set(p.user_id, p.id)
  }

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
    if (!s.linked_user_id) continue
    const pid = profileIdPorUserId.get(s.linked_user_id)
    if (s.whatsapp) {
      whatsappPorId.set(s.linked_user_id, s.whatsapp)
      if (pid) whatsappPorId.set(pid, s.whatsapp)
    }
    if (s.nome) {
      nomeSellerPorId.set(s.linked_user_id, s.nome)
      if (pid) nomeSellerPorId.set(pid, s.nome)
    }
  }

  return {
    nome: (id) =>
      (id ? nomePorId.get(id) ?? nomeSellerPorId.get(id) : undefined) ??
      'Sem responsável',
    whatsapp: (id) => (id ? whatsappPorId.get(id) ?? null : null),
  }
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

  const { data: deals } = await supabase
    .from('deals')
    .select('id, title, assigned_to, updated_at, expected_close_date, closed_at')
    .eq('account_id', accountId)
    .is('closed_at', null)

  const resolver = await resolverVendedores(supabase, accountId)
  const alertas: AlertaAcompanhamento[] = []

  for (const d of (deals ?? []) as {
    id: string
    title: string | null
    assigned_to: string | null
    updated_at: string | null
    expected_close_date: string | null
  }[]) {
    const vendedor_nome = resolver.nome(d.assigned_to)

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

  const mapa = new Map<string, ResumoVendedor>()
  for (const a of alertas) {
    const chave = a.vendedor_id ?? '__sem_responsavel__'
    const cur = mapa.get(chave) ?? {
      vendedor_id: a.vendedor_id,
      vendedor: a.vendedor_nome,
      whatsapp: resolver.whatsapp(a.vendedor_id),
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

// ============================================================
// MOTOR DE CADÊNCIA — os toques D+N da régua aprovada, por negócio.
// ============================================================

export interface ToqueDevido {
  deal_id: string
  titulo: string
  vendedor_id: string | null
  vendedor_nome: string
  vendedor_whatsapp: string | null
  stage_id: string | null
  dia_toque: number
  quando: string
  canal: string
  acao: string
  dias_na_etapa: number
}

interface ToqueRegua {
  dia: number
  quando: string
  canal: string
  acao: string
}

/** Extrai os toques de cadência ATIVA (D+N) da régua, ignorando recorrentes
 * (reunião do gestor) e pós-fechamento (v1 = pré-venda). Ordena por dia. */
export function extrairToquesAtivos(regua: unknown): ToqueRegua[] {
  if (!Array.isArray(regua)) return []
  const toques: ToqueRegua[] = []
  for (const item of regua) {
    if (!item || typeof item !== 'object') continue
    const t = item as { quando?: unknown; canal?: unknown; acao?: unknown }
    const quando = String(t.quando ?? '')
    const canal = String(t.canal ?? 'WhatsApp')
    const acao = String(t.acao ?? '')
    if (/segunda|semanal|semana|mensal/i.test(quando)) continue
    if (/fechamento|p[óo]s-?venda|recompra|ganho/i.test(quando)) continue
    const m = quando.match(/D\s*\+\s*(\d+)/i)
    if (!m) continue
    toques.push({ dia: parseInt(m[1], 10), quando, canal, acao })
  }
  return toques.sort((a, b) => a.dia - b.dia)
}

export async function detectarCadencia(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  accountId: string
}): Promise<ToqueDevido[]> {
  const { supabase, accountId } = args
  const agoraMs = Date.now()

  // 1. Régua do pacote APROVADO (só cobra cadência de quem já aprovou).
  const { data: entregavel } = await supabase
    .from('ccc_entregaveis')
    .select('entregaveis, status, created_at')
    .eq('account_id', accountId)
    .eq('status', 'aprovado')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const regua = (entregavel?.entregaveis as { regua_cadencia?: unknown } | null)
    ?.regua_cadencia
  const toques = extrairToquesAtivos(regua)
  if (toques.length === 0) return []

  // 2. Deals abertos.
  const { data: deals } = await supabase
    .from('deals')
    .select('id, title, assigned_to, stage_id, updated_at')
    .eq('account_id', accountId)
    .is('closed_at', null)
  const listaDeals = (deals ?? []) as {
    id: string
    title: string | null
    assigned_to: string | null
    stage_id: string | null
    updated_at: string | null
  }[]
  if (listaDeals.length === 0) return []

  const dealIds = listaDeals.map((d) => d.id)

  // 3. Último evento de etapa por deal (o marco zero da cadência).
  const { data: eventos } = await supabase
    .from('deal_stage_events')
    .select('deal_id, stage_id, entered_at')
    .in('deal_id', dealIds)
    .order('entered_at', { ascending: false })

  const ultimoEvento = new Map<string, { stage_id: string | null; entered_at: string }>()
  for (const e of (eventos ?? []) as {
    deal_id: string
    stage_id: string | null
    entered_at: string
  }[]) {
    if (!ultimoEvento.has(e.deal_id)) {
      ultimoEvento.set(e.deal_id, { stage_id: e.stage_id, entered_at: e.entered_at })
    }
  }

  // 4. Toques já disparados (idempotência).
  const { data: logs } = await supabase
    .from('ccc_cadencia_log')
    .select('deal_id, stage_id, dia_toque')
    .eq('account_id', accountId)
  const jaEnviado = new Set<string>()
  for (const l of (logs ?? []) as {
    deal_id: string
    stage_id: string | null
    dia_toque: number
  }[]) {
    jaEnviado.add(`${l.deal_id}|${l.stage_id ?? ''}|${l.dia_toque}`)
  }

  const resolver = await resolverVendedores(supabase, accountId)
  const devidos: ToqueDevido[] = []

  for (const d of listaDeals) {
    const ev = ultimoEvento.get(d.id)
    const marcoISO = ev?.entered_at ?? d.updated_at
    const stageId = ev?.stage_id ?? d.stage_id ?? null
    const diasNaEtapa = diasDesde(marcoISO, agoraMs)

    // toques cujo dia já venceu e que ainda não foram cobrados nesta etapa
    const pendentes = toques.filter(
      (t) =>
        t.dia <= diasNaEtapa &&
        !jaEnviado.has(`${d.id}|${stageId ?? ''}|${t.dia}`),
    )
    if (pendentes.length === 0) continue
    const alvo = pendentes[pendentes.length - 1] // o mais avançado já devido

    devidos.push({
      deal_id: d.id,
      titulo: d.title ?? 'Sem título',
      vendedor_id: d.assigned_to,
      vendedor_nome: resolver.nome(d.assigned_to),
      vendedor_whatsapp: resolver.whatsapp(d.assigned_to),
      stage_id: stageId,
      dia_toque: alvo.dia,
      quando: alvo.quando,
      canal: alvo.canal,
      acao: alvo.acao,
      dias_na_etapa: diasNaEtapa,
    })
  }

  return devidos
}
