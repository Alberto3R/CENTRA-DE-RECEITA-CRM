/**
 * Conexão pela coexistência quando a Meta fecha o Embedded Signup só com o
 * `waba_id` (o evento FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING não garante o
 * `phone_number_id`). O back tem que achar o número na WABA e seguir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.NEXT_PUBLIC_META_APP_ID = 'app-1'
process.env.META_EMBEDDED_SIGNUP_APP_SECRET = 'segredo-app'
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)

// Banco falso: só o que a rota usa. Cada chamada fica registrada.
type Call = { table: string; op: string; payload?: unknown }
const calls: Call[] = []

function fakeDb() {
  return {
    from(table: string) {
      let op = 'select'
      let payload: unknown
      const result = () => {
        calls.push({ table, op, payload })
        if (op === 'insert') return { data: { id: 'canal-novo' }, error: null }
        if (op === 'select') return { data: [], error: null, count: 0 }
        return { data: null, error: null }
      }
      const q = {
        select: () => q,
        eq: () => q,
        single: () => q,
        insert: (p: unknown) => ((op = 'insert'), (payload = p), q),
        update: (p: unknown) => ((op = 'update'), (payload = p), q),
        then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
      }
      return q
    },
  }
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'conta-ma', userId: 'user-1', supabase: fakeDb() }),
  toErrorResponse: () => new Response('erro', { status: 500 }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb() }))

// Meta falsa.
const graph: string[] = []
function metaFetch(numbers: Array<{ id: string; on_app?: boolean }>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    graph.push(`${init?.method ?? 'GET'} ${url.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+/, '')}`)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (url.includes('/oauth/access_token')) return json({ access_token: 'token-cliente' })
    if (url.includes('/waba-1/phone_numbers'))
      return json({ data: numbers.map((n) => ({ id: n.id, display_phone_number: `55 31 9${n.id}` })) })
    const onApp = url.match(/\/(\w+)\?fields=is_on_biz_app/)
    if (onApp) return json({ is_on_biz_app: numbers.find((n) => n.id === onApp[1])?.on_app ?? false })
    if (url.includes('/subscribed_apps')) return json({ success: true })
    if (url.includes('/smb_app_data')) return json({ success: true })
    const node = url.match(/\/(\w+)\?fields=id,display_phone_number/)
    if (node) return json({ id: node[1], display_phone_number: `55 31 9${node[1]}` })
    return new Response('{}', { status: 404 })
  })
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('./route')
  return POST(new Request('http://x/api/whatsapp/coexistence/onboard', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  calls.length = 0
  graph.length = 0
})

describe('POST /api/whatsapp/coexistence/onboard sem phone_number_id', () => {
  it('acha o único número da WABA e grava o canal', async () => {
    vi.stubGlobal('fetch', metaFetch([{ id: '111' }]))
    const res = await post({ code: 'c', waba_id: 'waba-1', label: 'Thais' })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    const insert = calls.find((c) => c.op === 'insert')?.payload as Record<string, unknown>
    expect(insert.phone_number_id).toBe('111')
    expect(insert.connection_mode).toBe('coexistence')
    expect(graph).toContain('POST /111/smb_app_data')
  })

  it('com 2 números, escolhe o que está no app do celular', async () => {
    vi.stubGlobal('fetch', metaFetch([{ id: '111' }, { id: '222', on_app: true }]))
    const res = await post({ code: 'c', waba_id: 'waba-1' })

    expect(res.status).toBe(200)
    const insert = calls.find((c) => c.op === 'insert')?.payload as Record<string, unknown>
    expect(insert.phone_number_id).toBe('222')
  })

  it('ambíguo: não grava nada e explica', async () => {
    vi.stubGlobal('fetch', metaFetch([{ id: '111' }, { id: '222' }]))
    const res = await post({ code: 'c', waba_id: 'waba-1' })

    expect(res.status).toBe(409)
    expect(calls.some((c) => c.op === 'insert')).toBe(false)
    expect(graph.some((g) => g.includes('smb_app_data'))).toBe(false)
  })

  it('com phone_number_id não consulta a lista da WABA', async () => {
    vi.stubGlobal('fetch', metaFetch([{ id: '111' }, { id: '222' }]))
    const res = await post({ code: 'c', waba_id: 'waba-1', phone_number_id: '222' })

    expect(res.status).toBe(200)
    expect(graph.some((g) => g.includes('/phone_numbers'))).toBe(false)
  })
})
