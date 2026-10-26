/**
 * Captação por formulário (POST /api/leads/[token]).
 *
 * Os três problemas vistos na conta do Ranieri (out/2026): telefone gravado
 * sem o 55 (a Meta lia o DDD como país e o lead não recebia nada), um negócio
 * novo a cada reenvio do formulário, e a boas-vindas que não aparecia no inbox.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Banco falso em memória: só o que a rota usa. ───────────────────────────
type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
let seq = 0

function digits(v: unknown) {
  return String(v ?? '').replace(/\D/g, '')
}

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
      let payload: Row | Row[] | null = null
      let single = false
      let limit: number | null = null
      const rows = () => (tables[table] ??= [])

      const run = () => {
        if (op === 'insert' || op === 'upsert') {
          const list = Array.isArray(payload) ? payload : [payload as Row]
          const out: Row[] = []
          for (const p of list) {
            const row: Row = { id: `${table}-${++seq}`, created_at: new Date(seq * 1000).toISOString(), ...p }
            if (table === 'contacts') {
              row.phone_normalized = digits(row.phone)
              const dup = rows().find(
                (r) => r.account_id === row.account_id && r.phone_normalized === row.phone_normalized,
              )
              if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } }
            }
            rows().push(row)
            out.push(row)
            // Gatilho do banco: todo negócio novo ganha o evento 'created'.
            if (table === 'deals') {
              ;(tables.deal_events ??= []).push({
                id: `ev-${++seq}`,
                deal_id: row.id,
                account_id: row.account_id,
                type: 'created',
              })
            }
          }
          return { data: single ? out[0] : out, error: null }
        }
        const matched = rows().filter((r) => filters.every((f) => f(r)))
        if (op === 'update') {
          for (const r of matched) {
            const next = { ...r, ...(payload as Row) }
            if (table === 'contacts' && 'phone' in (payload as Row)) {
              next.phone_normalized = digits(next.phone)
              const dup = rows().find(
                (o) => o !== r && o.account_id === next.account_id && o.phone_normalized === next.phone_normalized,
              )
              if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } }
            }
            Object.assign(r, next)
          }
          return { data: matched, error: null }
        }
        const limited = limit != null ? matched.slice(0, limit) : matched
        return { data: single ? (limited[0] ?? null) : limited, error: null }
      }

      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), q),
        in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), q),
        order: () => q,
        limit: (n: number) => ((limit = n), q),
        maybeSingle: () => ((single = true), q),
        single: () => ((single = true), q),
        insert: (p: Row | Row[]) => ((op = 'insert'), (payload = p), q),
        upsert: (p: Row | Row[]) => ((op = 'upsert'), (payload = p), q),
        update: (p: Row) => ((op = 'update'), (payload = p), q),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(ok, ko),
      }
      return q
    },
  }
}

const db = fakeDb()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('@/lib/contacts/marcar-tag', () => ({ marcarContatoComTag: vi.fn(async () => true) }))
vi.mock('@/lib/whatsapp/channel', () => ({
  resolveChannelConfig: vi.fn(async () => ({ id: 'canal-1', phone_number_id: 'pn-1', access_token: 'x' })),
}))
const engineSendTemplate = vi.fn(async (args: Row) => ({ whatsapp_message_id: `wamid-${String(args.templateName)}` }))
vi.mock('@/lib/automations/meta-send', () => ({ engineSendTemplate }))

const CONTA = 'conta-ranieri'
const FUNIL = 'funil-meteorico'

function seed(cfg: Partial<Row> = {}) {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.lead_capture_config = [
    {
      id: 'cfg-1',
      token: 'tok',
      enabled: true,
      account_id: CONTA,
      pipeline_id: FUNIL,
      stage_id: 'etapa-base',
      name: 'Landing Pós ESFS - Meteórico',
      default_tag_id: null,
      welcome_template: null,
      ...cfg,
    },
  ]
  tables.accounts = [{ id: CONTA, owner_user_id: 'dono', default_currency: 'BRL' }]
  tables.message_templates = [
    {
      channel_id: 'canal-1',
      name: 'boas_vindas',
      status: 'APPROVED',
      language: 'pt_BR',
      body_text: 'Oi, {{1}}! Recebemos seu cadastro.',
    },
  ]
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('./route')
  const res = await POST(
    new Request('http://x/api/leads/tok', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ token: 'tok' }) },
  )
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  seed()
  engineSendTemplate.mockClear()
})

describe('POST /api/leads/[token] — telefone', () => {
  it('grava o lead novo com o 55 do Brasil', async () => {
    const { status, json } = await post({ nome: 'Maria Souza', whatsapp: '(81) 99999-1234' })

    expect(status).toBe(200)
    const contato = tables.contacts.find((c) => c.id === json.contact_id)!
    expect(contato.phone).toBe('5581999991234')
    expect(contato.phone_normalized).toBe('5581999991234')
  })

  it('acha o contato antigo gravado sem 55 e corrige o telefone dele', async () => {
    tables.contacts = [
      { id: 'velho', account_id: CONTA, phone: '81999991234', phone_normalized: '81999991234', name: 'Maria' },
    ]

    const { json } = await post({ nome: 'Maria', whatsapp: '81999991234' })

    expect(json.contact_id).toBe('velho')
    expect(tables.contacts).toHaveLength(1)
    expect(tables.contacts[0].phone_normalized).toBe('5581999991234')
  })

  it('prefere o contato que já tem o 55 quando existem os dois', async () => {
    tables.contacts = [
      { id: 'sem55', account_id: CONTA, phone: '81999991234', phone_normalized: '81999991234' },
      { id: 'com55', account_id: CONTA, phone: '5581999991234', phone_normalized: '5581999991234' },
    ]

    const { json } = await post({ nome: 'Maria', whatsapp: '81999991234' })

    expect(json.contact_id).toBe('com55')
    expect(tables.contacts.find((c) => c.id === 'sem55')!.phone_normalized).toBe('81999991234')
  })
})

describe('POST /api/leads/[token] — negócio', () => {
  it('abre um negócio e marca o histórico como criado via integração', async () => {
    const { json } = await post({ nome: 'Maria', whatsapp: '81999991234', utm_source: 'ig' })

    expect(json.reused_deal).toBe(false)
    expect(tables.deals).toHaveLength(1)
    const ev = tables.deal_events.find((e) => e.deal_id === json.deal_id)!
    expect(ev.type).toBe('created_via_integration')
  })

  it('reaproveita o negócio aberto quando a pessoa preenche de novo', async () => {
    const primeiro = await post({ nome: 'Maria', whatsapp: '81999991234' })
    const segundo = await post({ nome: 'Maria', whatsapp: '(81) 9 9999-1234' })

    expect(segundo.json.deal_id).toBe(primeiro.json.deal_id)
    expect(segundo.json.reused_deal).toBe(true)
    expect(tables.deals).toHaveLength(1)
    const tipos = tables.deal_events.filter((e) => e.deal_id === primeiro.json.deal_id).map((e) => e.type)
    expect(tipos).toEqual(['created_via_integration', 'form_resubmitted'])
  })

  it('abre negócio novo se o anterior já foi fechado', async () => {
    tables.contacts = [{ id: 'c1', account_id: CONTA, phone: '5581999991234', phone_normalized: '5581999991234' }]
    tables.deals = [{ id: 'd-velho', account_id: CONTA, contact_id: 'c1', pipeline_id: FUNIL, status: 'lost' }]

    const { json } = await post({ nome: 'Maria', whatsapp: '81999991234' })

    expect(json.reused_deal).toBe(false)
    expect(json.deal_id).not.toBe('d-velho')
  })
})

describe('POST /api/leads/[token] — boas-vindas', () => {
  it('manda o template pelo caminho que grava no inbox, com o primeiro nome', async () => {
    seed({ welcome_template: 'boas_vindas' })

    const { json } = await post({ nome: 'Maria Souza', whatsapp: '81999991234' })

    expect(json.welcome_sent).toBe(true)
    expect(engineSendTemplate).toHaveBeenCalledTimes(1)
    const arg = engineSendTemplate.mock.calls[0][0]
    expect(arg.templateName).toBe('boas_vindas')
    expect(arg.params).toEqual(['Maria'])
    expect(arg.contentText).toBe('Oi, Maria! Recebemos seu cadastro.')
    expect(tables.conversations).toHaveLength(1)
    expect(arg.conversationId).toBe(tables.conversations[0].id)
  })

  it('não manda de novo para quem reenvia o formulário', async () => {
    seed({ welcome_template: 'boas_vindas' })

    await post({ nome: 'Maria', whatsapp: '81999991234' })
    await post({ nome: 'Maria', whatsapp: '81999991234' })

    expect(engineSendTemplate).toHaveBeenCalledTimes(1)
  })

  it('sem template configurado, não manda nada', async () => {
    const { json } = await post({ nome: 'Maria', whatsapp: '81999991234' })

    expect(json.welcome_sent).toBe(false)
    expect(engineSendTemplate).not.toHaveBeenCalled()
  })
})
