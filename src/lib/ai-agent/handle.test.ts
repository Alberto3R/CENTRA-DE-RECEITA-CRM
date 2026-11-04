/**
 * Agente × rajada: uma resposta por vez.
 *
 * Caso real (conta do Ranieri, 25/10): o lead manda "Oi"; o agente responde e
 * pergunta a graduação; o "Boa tarde" do lead chega no mesmo segundo do envio
 * e a rodada dele perguntava de novo. Banco em memória; o relógio anda 1 s a
 * cada linha gravada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
let seq = 0
let clock = 0
const T0 = Date.UTC(2026, 9, 25, 17, 23, 0)
const agora = () => new Date(T0 + ++clock * 1000).toISOString()

function filtroOr(expr: string): (r: Row) => boolean {
  const partes = expr.split(',').map((p) => {
    const [col, ...resto] = p.split('.')
    const op = resto.join('.')
    if (op === 'not.is.null') return (r: Row) => r[col] != null
    if (op === 'is.null') return (r: Row) => r[col] == null
    if (op.startsWith('neq.')) return (r: Row) => r[col] !== op.slice(4)
    throw new Error(`or() não suportado: ${p}`)
  })
  return (r) => partes.some((f) => f(r))
}

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let op: 'select' | 'insert' | 'update' = 'select'
      let payload: Row = {}
      let single = false
      let head = false
      let limit: number | null = null
      let order: { col: string; asc: boolean } | null = null
      const rows = () => (tables[table] ??= [])

      const run = () => {
        if (op === 'insert') {
          const row: Row = { id: `${table}-${++seq}`, created_at: agora(), ...payload }
          rows().push(row)
          return { data: single ? row : [row], error: null }
        }
        let matched = rows().filter((r) => filters.every((f) => f(r)))
        if (op === 'update') {
          for (const r of matched) Object.assign(r, payload)
          return { data: matched, error: null }
        }
        if (order) {
          const { col, asc } = order
          matched = [...matched].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1))
        }
        if (head) return { data: null, count: matched.length, error: null }
        if (limit != null) matched = matched.slice(0, limit)
        return { data: single ? (matched[0] ?? null) : matched, error: null }
      }

      const q = {
        select: (_cols?: string, opts?: { head?: boolean }) => ((head = Boolean(opts?.head)), q),
        eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), q),
        gt: (col: string, val: string) => (filters.push((r) => String(r[col]) > val), q),
        gte: (col: string, val: string) => (filters.push((r) => String(r[col]) >= val), q),
        in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), q),
        is: (col: string, val: unknown) => (filters.push((r) => (r[col] ?? null) === val), q),
        or: (expr: string) => (filters.push(filtroOr(expr)), q),
        order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending ?? true }), q),
        limit: (n: number) => ((limit = n), q),
        maybeSingle: () => ((single = true), q),
        single: () => ((single = true), q),
        insert: (p: Row) => ((op = 'insert'), (payload = p), q),
        update: (p: Row) => ((op = 'update'), (payload = p), q),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
      }
      return q
    },
  }
}

const db = fakeDb()
const { runAgent } = vi.hoisted(() => ({ runAgent: vi.fn() }))

vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => db }))
vi.mock('@/lib/whatsapp/channel', () => ({ resolveChannelConfig: vi.fn(async () => ({ id: 'canal' })) }))
vi.mock('@/lib/messaging/send', () => ({
  isInstagramChannel: () => false,
  isQrChannel: () => false,
  sendTextViaChannel: vi.fn(),
}))
vi.mock('@/lib/google/calendar', () => ({ availableSlots: vi.fn(), createMeetEvent: vi.fn() }))
vi.mock('@/lib/pipeline/auto-advance', () => ({ advanceDealsOnCallBooked: vi.fn() }))
vi.mock('./outbound-context', () => ({
  loadOutboundTurns: vi.fn(async () => []),
  formatTemplateTurn: (_n: string, body: string) => body,
}))
vi.mock('./respond', () => ({ runAgent }))

import { maybeRunAgent } from './handle'

function resposta(reply: string) {
  return { reply, handoff: false, handoff_motivo: '', intencao: 'qualificacao', resumo: '', publico: '', silencio: false }
}

function lead(text: string) {
  tables.messages.push({
    id: `messages-${++seq}`,
    conversation_id: 'conv',
    sender_type: 'customer',
    content_text: text,
    created_at: agora(),
  })
}

function rodada(inboundText: string) {
  return maybeRunAgent({
    supabase: db as never,
    accountId: 'conta',
    conversationId: 'conv',
    contactWaId: '5511999991234',
    phoneNumberId: 'pn',
    channelId: 'canal',
    accessToken: 'tok',
    inboundText,
    esperaMs: 0,
  })
}

const doBot = () => tables.messages.filter((m) => m.sender_type === 'bot').map((m) => m.content_text)
const turnos = () => tables.ai_agente_turnos?.map((t) => t.intencao) ?? []

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  clock = 0
  tables.ai_agent_config = [
    {
      id: 'agente',
      channel_id: 'canal',
      enabled: true,
      system_prompt: 'Qualifique o lead.',
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      handoff_keyword: 'atendente',
      handoff_message: 'Já chamo alguém do time.',
      scheduling_enabled: false,
    },
  ]
  tables.conversations = [{ id: 'conv', account_id: 'conta', contact_id: 'contato', ai_handoff: false }]
  tables.messages = []
  runAgent.mockImplementation(async ({ incomingText }: { incomingText: string }) =>
    resposta(`Resposta a "${incomingText}". Você tem graduação completa?`),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid' }] }), { status: 200 })),
  )
})

describe('maybeRunAgent — uma resposta por vez', () => {
  it('2 balões seguidos recebem uma resposta só, à última mensagem', async () => {
    lead('Oi')
    lead('Boa tarde')

    await rodada('Oi')
    await rodada('Boa tarde')

    expect(runAgent).toHaveBeenCalledTimes(1)
    expect(doBot()).toEqual(['Resposta a "Boa tarde". Você tem graduação completa?'])
    expect(turnos()).toEqual(['descartada', 'qualificacao'])
  })

  it('balão que cruza com o envio da resposta não gera a pergunta de novo', async () => {
    lead('Oi')
    // A rodada do "Oi" pensa; o "Boa tarde" chega quando ela já passou pelo
    // guarda e está enviando (antes de gravar o turno).
    runAgent.mockImplementationOnce(async () => resposta('Oi! Você tem graduação completa?'))
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementationOnce(async () => {
      lead('Boa tarde')
      return new Response(JSON.stringify({ messages: [{ id: 'wamid' }] }), { status: 200 })
    })

    await rodada('Oi')
    await rodada('Boa tarde')

    expect(runAgent).toHaveBeenCalledTimes(1)
    expect(doBot()).toEqual(['Oi! Você tem graduação completa?'])
    expect(turnos()).toEqual(['qualificacao', 'descartada'])
  })

  it('mensagem que chega enquanto o modelo pensa descarta a resposta defasada', async () => {
    lead('Oi')
    runAgent.mockImplementationOnce(async () => {
      lead('Sou formado em ADS')
      return resposta('Você tem graduação completa?')
    })

    await rodada('Oi')
    await rodada('Sou formado em ADS')

    expect(doBot()).toEqual(['Resposta a "Sou formado em ADS". Você tem graduação completa?'])
    expect(turnos()).toEqual(['descartada', 'qualificacao'])
  })

  it('a resposta do lead depois da pergunta segue a conversa normalmente', async () => {
    lead('Oi')
    await rodada('Oi')
    lead('Tenho sim, em ADS')
    await rodada('Tenho sim, em ADS')

    expect(runAgent).toHaveBeenCalledTimes(2)
    expect(doBot()).toHaveLength(2)
    expect(turnos()).toEqual(['qualificacao', 'qualificacao'])
  })

  it('silêncio de outra rodada não cala a próxima', async () => {
    lead('Mensagem automática da loja')
    runAgent.mockImplementationOnce(async () => ({ ...resposta(''), silencio: true }))
    await rodada('Mensagem automática da loja')
    lead('Oi, quero saber da pós')
    await rodada('Oi, quero saber da pós')

    expect(doBot()).toEqual(['Resposta a "Oi, quero saber da pós". Você tem graduação completa?'])
  })

  it('automação que respondeu antes (isca por palavra-chave) não cala o agente', async () => {
    lead('quero o MAPA')
    tables.messages.push({
      id: 'isca',
      conversation_id: 'conv',
      sender_type: 'bot',
      content_text: 'Aqui está o Mapa do Funil: https://…',
      created_at: agora(),
    })

    await rodada('quero o MAPA')

    expect(runAgent).toHaveBeenCalledTimes(1)
    expect(doBot()).toHaveLength(2)
  })

  it('palavra-chave seguida de outro balão ainda passa para o humano', async () => {
    lead('quero falar com um atendente')
    lead('por favor')

    await rodada('quero falar com um atendente')
    await rodada('por favor')

    expect(doBot()).toEqual(['Já chamo alguém do time.'])
    expect(tables.conversations[0].ai_handoff).toBe(true)
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('humano que assume durante a espera cala o agente', async () => {
    lead('Oi')
    const original = db.from.bind(db)
    // A espera acaba e o humano já assumiu a conversa.
    tables.conversations[0].ai_handoff = false
    const spy = vi.spyOn(db, 'from').mockImplementation((t: string) => {
      if (t === 'ai_agente_turnos' || t === 'messages') tables.conversations[0].ai_handoff = true
      return original(t)
    })

    await rodada('Oi')
    spy.mockRestore()

    expect(runAgent).not.toHaveBeenCalled()
    expect(doBot()).toEqual([])
  })
})
