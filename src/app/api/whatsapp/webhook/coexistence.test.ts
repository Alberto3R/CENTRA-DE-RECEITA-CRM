/**
 * Webhook × Coexistência — ponta a ponta com um banco em memória.
 *
 * Exercita o POST real (assinatura HMAC de verdade) com os três campos da
 * coexistência e confere o que fica gravado: echo do celular, histórico,
 * agenda e o dedupe de mensagem repetida.
 */
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encrypt } from '@/lib/whatsapp/encryption'

// ------------------------------------------------------------------
// Banco falso (só o pedaço do query builder do supabase-js que o
// webhook usa).
// ------------------------------------------------------------------
type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let seq = 0

const UNIQUE: Record<string, string[][]> = {
  messages: [['conversation_id', 'message_id']],
  whatsapp_app_contacts: [['channel_id', 'phone']],
}

function violates(table: string, row: Row, ignoreId?: unknown): boolean {
  return (UNIQUE[table] ?? []).some((cols) =>
    (db[table] ?? []).some(
      (r) =>
        r.id !== ignoreId &&
        cols.every((c) => row[c] != null && r[c] === row[c]),
    ),
  )
}

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  let payload: Row | Row[] = {}
  let mode: 'many' | 'single' | 'maybe' = 'many'
  let limit = Infinity
  let head = false
  let onConflict: string[] = []

  const rows = () => (db[table] ??= [])

  function run(): { data: unknown; error: unknown; count?: number } {
    if (op === 'insert') {
      const list = Array.isArray(payload) ? payload : [payload]
      const created: Row[] = []
      for (const p of list) {
        const row = { id: `id-${++seq}`, ...p }
        if (violates(table, row)) {
          // Postgres: o lote inteiro falha.
          for (const c of created) rows().splice(rows().indexOf(c), 1)
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        rows().push(row)
        created.push(row)
      }
      return finish(created)
    }
    if (op === 'upsert') {
      const p = payload as Row
      const hit = rows().find((r) => onConflict.every((c) => r[c] === p[c]))
      if (hit) Object.assign(hit, p)
      else rows().push({ id: `id-${++seq}`, ...p })
      return { data: null, error: null }
    }
    const matched = rows().filter((r) => filters.every((f) => f(r)))
    if (op === 'update') {
      for (const r of matched) Object.assign(r, payload)
      return { data: null, error: null }
    }
    if (head) return { data: null, error: null, count: matched.length }
    return finish(matched.slice(0, limit))
  }

  function finish(list: Row[]) {
    if (mode === 'many') return { data: list, error: null }
    if (list.length === 0) {
      return mode === 'single'
        ? { data: null, error: { code: 'PGRST116', message: 'no rows' } }
        : { data: null, error: null }
    }
    return { data: list[0], error: null }
  }

  const b: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head) head = true
      return b
    },
    insert: (p: Row | Row[]) => ((op = 'insert'), (payload = p), b),
    update: (p: Row) => ((op = 'update'), (payload = p), b),
    upsert: (p: Row, o: { onConflict: string }) => (
      (op = 'upsert'), (payload = p), (onConflict = o.onConflict.split(',')), b
    ),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
    not: (c: string, _o: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), b),
    like: (c: string, pat: string) => (
      filters.push((r) => String(r[c] ?? '').endsWith(pat.replace(/^%/, ''))), b
    ),
    order: () => b,
    limit: (n: number) => ((limit = n), b),
    single: () => ((mode = 'single'), b),
    maybeSingle: () => ((mode = 'maybe'), b),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(res, rej),
  }
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => builder(t) }),
}))

// after(): roda o trabalho e deixa o teste esperar por ele.
const pending: Promise<unknown>[] = []
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (p: Promise<unknown>) => {
    pending.push(p)
  },
}))

const flows = vi.fn(async () => ({ consumed: false }))
const automations = vi.fn(async () => {})
const agent = vi.fn(async () => {})
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: flows }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: automations }))
vi.mock('@/lib/ai-agent/handle', () => ({ maybeRunAgent: agent }))
vi.mock('@/lib/pipeline/auto-advance', () => ({ advanceDealsOnFirstReply: vi.fn() }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(async () => ({ url: 'https://x', mimeType: 'image/jpeg' })),
  downloadMedia: vi.fn(),
}))

const { POST } = await import('./route')

// ------------------------------------------------------------------

const PNID = '106540352242922'
const BIZ = '5561947560298'
const CLIENTE = '5511988887777'

function seed(connectionMode: 'cloud' | 'coexistence' = 'coexistence') {
  for (const k of Object.keys(db)) delete db[k]
  db.whatsapp_config = [
    {
      id: 'ch-1',
      account_id: 'acc-1',
      user_id: 'u-1',
      phone_number_id: PNID,
      access_token: encrypt('tok'),
      connection_mode: connectionMode,
    },
  ]
  db.contacts = []
  db.conversations = []
  db.messages = []
}

async function send(field: string, value: Record<string, unknown>) {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field,
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: BIZ, phone_number_id: PNID },
              ...value,
            },
          },
        ],
      },
    ],
  })
  const sig = 'sha256=' + createHmac('sha256', 'test-meta-app-secret').update(body).digest('hex')
  const res = await POST(
    new Request('http://x/api/whatsapp/webhook', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sig },
    }),
  )
  expect(res.status).toBe(200)
  await Promise.all(pending.splice(0))
}

const inbound = (id: string, text: string, ts = '1700000000') => ({
  contacts: [{ profile: { name: 'Pablo' }, wa_id: CLIENTE }],
  messages: [{ id, from: CLIENTE, timestamp: ts, type: 'text', text: { body: text } }],
})

beforeEach(() => {
  flows.mockClear()
  automations.mockClear()
  agent.mockClear()
})

describe('dedupe de mensagem recebida', () => {
  it('retentativa da Meta não grava de novo nem dispara bot de novo', async () => {
    seed('cloud')
    await send('messages', inbound('wamid.A', 'oi'))
    await send('messages', inbound('wamid.A', 'oi'))
    expect(db.messages).toHaveLength(1)
    expect(flows).toHaveBeenCalledTimes(1)
    expect(agent).toHaveBeenCalledTimes(1)
    expect(db.conversations[0].unread_count).toBe(1)
  })
})

describe('coexistência', () => {
  it('número do celular: grava a mensagem mas flows e automações não respondem', async () => {
    seed('coexistence')
    await send('messages', inbound('wamid.B', 'quero saber o preço'))
    expect(db.messages).toHaveLength(1)
    expect(flows).not.toHaveBeenCalled()
    expect(automations).not.toHaveBeenCalled()
    // Agente é por canal: o handle decide (sem config no canal, não responde).
    expect(agent).toHaveBeenCalledTimes(1)
  })

  it('echo: o que o vendedor manda pelo celular entra como atendente e pausa a IA', async () => {
    seed()
    await send('smb_message_echoes', {
      message_echoes: [
        { from: BIZ, to: CLIENTE, id: 'wamid.E1', timestamp: '1700000100', type: 'text', text: { body: 'Te mando a proposta' } },
      ],
    })
    expect(db.messages).toHaveLength(1)
    const m = db.messages[0]
    expect(m).toMatchObject({ sender_type: 'agent', origin: 'app', status: 'sent', content_text: 'Te mando a proposta' })
    expect(db.contacts[0].phone).toBe(CLIENTE)
    expect(db.conversations[0]).toMatchObject({ channel_id: 'ch-1', ai_handoff: true, last_message_text: 'Te mando a proposta' })
    expect(flows).not.toHaveBeenCalled()
    expect(agent).not.toHaveBeenCalled()

    // echo repetido
    await send('smb_message_echoes', {
      message_echoes: [{ from: BIZ, to: CLIENTE, id: 'wamid.E1', timestamp: '1700000100', type: 'text', text: { body: 'Te mando a proposta' } }],
    })
    expect(db.messages).toHaveLength(1)
  })

  it('agenda: guarda à parte, não cria contato e dá nome a quem conversar', async () => {
    seed()
    await send('smb_app_state_sync', {
      state_sync: [
        { type: 'contact', action: 'add', contact: { full_name: 'Pablo Morales', first_name: 'Pablo', phone_number: CLIENTE } },
      ],
    })
    expect(db.contacts).toHaveLength(0)
    expect(db.whatsapp_app_contacts).toHaveLength(1)

    await send('smb_message_echoes', {
      message_echoes: [{ from: BIZ, to: CLIENTE, id: 'wamid.E2', timestamp: '1700000200', type: 'text', text: { body: 'Oi Pablo' } }],
    })
    expect(db.contacts[0].name).toBe('Pablo Morales')
  })

  it('histórico: importa calado, separa quem falou e não duplica', async () => {
    seed()
    // Uma mensagem já chegou ao vivo antes do lote do histórico.
    await send('messages', inbound('wamid.H2', 'pode ser amanhã', '1700000300'))
    agent.mockClear()

    await send('history', {
      history: [
        {
          metadata: { phase: 2, chunk_order: 1, progress: 100 },
          threads: [
            {
              id: CLIENTE,
              messages: [
                { from: BIZ, id: 'wamid.H1', timestamp: '1700000000', type: 'text', text: { body: 'Bom dia!' }, history_context: { status: 'READ' } },
                { from: CLIENTE, id: 'wamid.H2', timestamp: '1700000300', type: 'text', text: { body: 'pode ser amanhã' } },
                { from: CLIENTE, id: 'wamid.H3', timestamp: '1700000200', type: 'image', image: { id: 'media-9', mime_type: 'image/jpeg' } },
              ],
            },
          ],
        },
      ],
    })

    expect(db.messages).toHaveLength(3)
    const byId = Object.fromEntries(db.messages.map((m) => [m.message_id, m]))
    expect(byId['wamid.H1']).toMatchObject({ sender_type: 'agent', origin: 'history', status: 'read' })
    // A que veio ao vivo fica como estava (default 'api' do banco).
    expect(byId['wamid.H2'].origin).toBeUndefined()
    expect(byId['wamid.H3']).toMatchObject({ sender_type: 'customer', content_type: 'image', media_url: '/api/whatsapp/media/media-9' })
    expect(agent).not.toHaveBeenCalled()
    expect(db.conversations[0].unread_count).toBe(1) // só a mensagem ao vivo
    expect(db.whatsapp_config[0].coex_history_progress).toBe(100)
    expect(db.whatsapp_config[0].coex_history_completed_at).toBeTruthy()
  })

  it('histórico recusado pelo dono do número fica registrado no canal', async () => {
    seed()
    await send('history', {
      history: [{ errors: [{ code: 2593109, title: 'History sharing declined' }] }],
    })
    expect(db.whatsapp_config[0].coex_last_error).toBe('History sharing declined (código 2593109)')
  })
})
