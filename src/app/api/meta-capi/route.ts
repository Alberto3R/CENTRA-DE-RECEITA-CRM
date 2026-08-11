import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

// A Meta exige os dados pessoais em SHA-256 (minúsculo, sem espaço nas pontas).
// Hasheamos AQUI, no servidor: a landing manda em texto pelo HTTPS (como já faz
// pro CRM) e nada identificável sai daqui pra Meta.
function sha256(s: string): string {
  return crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex')
}
// telefone no formato que a Meta espera: só dígitos, com DDI
function normFone(v: string): string {
  const d = v.replace(/\D/g, '')
  if (!d) return ''
  return d.length <= 11 && !d.startsWith('55') ? '55' + d : d
}

// ============================================================
// POST /api/meta-capi — Conversions API (CAPI) da landing da CCC.
//
// Recebe o evento do Pixel client-side, completa com IP + User-Agent do
// request e reenvia server-side pro Pixel da 3R. O Pixel manda o mesmo
// event_id, então a Meta DEDUPLICA (não conta 2x). O token vem do canal
// WhatsApp já conectado (mesmo BM/pixel), descriptografado aqui — nenhum
// segredo em texto no repo. Rota pública (chamada da landing).
// ============================================================

const GRAPH = 'https://graph.facebook.com/v22.0'
const PIXEL_ID = '889803623429912' // pixel da 3R (público — também vai no client)
const WABA = '824812527258696' // canal cujo system user token gerencia o pixel

// 'LeadQualificado' é evento próprio: só dispara para quem bate o ICP. Serve
// para a campanha otimizar pelo lead que a gente QUER, não por lead qualquer.
//
// 'Schedule' é o padrão da Meta para "compromisso agendado" — o sinal de fundo
// de funil mais valioso que a gente tem. Ele NÃO pode vir pelo caminho do
// `fireConversion` (lib/conversions/capi.ts), porque aquele exige `ctwa_clid` e
// só existe para lead de Click-to-WhatsApp; lead vindo de landing tem `fbclid` e
// era descartado com `no_ctwa_clid` — na prática a Meta nunca soube de nenhuma
// reunião marcada. Aqui ele entra pelo mesmo caminho que já funciona (website +
// telefone/e-mail hasheados). 'LeadSubmitted' fica aceito por compatibilidade
// com o `capi_event` configurado na etapa "Raio-X agendado".
const EVENTOS_OK = new Set([
  'PageView',
  'ViewContent',
  'Lead',
  'LeadQualificado',
  'Schedule',
  'LeadSubmitted',
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

async function tokenDoCanal(): Promise<string | null> {
  const { data } = await admin()
    .from('whatsapp_config')
    .select('access_token')
    .eq('waba_id', WABA)
    .eq('status', 'connected')
    .not('access_token', 'is', null)
    .limit(1)
    .maybeSingle()
  if (!data?.access_token) return null
  try {
    return decrypt(data.access_token)
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const eventName =
      typeof body?.event_name === 'string' && EVENTOS_OK.has(body.event_name)
        ? body.event_name
        : 'PageView'
    const eventId =
      typeof body?.event_id === 'string' && body.event_id ? body.event_id : undefined
    const sourceUrl =
      typeof body?.event_source_url === 'string' ? body.event_source_url : undefined
    const fbp = typeof body?.fbp === 'string' && body.fbp ? body.fbp : undefined
    const fbc = typeof body?.fbc === 'string' && body.fbc ? body.fbc : undefined

    const token = await tokenDoCanal()
    if (!token) {
      return NextResponse.json({ error: 'capi_sem_token' }, { status: 500 })
    }

    // dados do cliente que só o servidor tem (melhora a qualidade da correspondência)
    const fwd = req.headers.get('x-forwarded-for') || ''
    const ip = fwd.split(',')[0].trim() || undefined
    const ua = req.headers.get('user-agent') || undefined

    const userData: Record<string, unknown> = {}
    if (ip) userData.client_ip_address = ip
    if (ua) userData.client_user_agent = ua
    if (fbp) userData.fbp = fbp
    if (fbc) userData.fbc = fbc

    // Perfil do lead (hasheado) — mandado JÁ no cadastro, não só quando o lead
    // avança de etapa. Sem isso a Meta otimiza praticamente às cegas: fbp/fbc
    // só existem pra quem veio de clique no anúncio e caem quando o cookie some.
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const email = s(body?.email)
    const fone = normFone(s(body?.phone) || s(body?.whatsapp))
    const nome = s(body?.nome)
    if (email) userData.em = [sha256(email)]
    if (fone) userData.ph = [sha256(fone)]
    if (nome) {
      const p = nome.split(/\s+/).filter(Boolean)
      if (p[0]) userData.fn = [sha256(p[0])]
      if (p.length > 1) userData.ln = [sha256(p[p.length - 1])]
    }
    // external_id estável (o próprio telefone) ajuda a Meta a ligar o mesmo
    // lead entre eventos diferentes.
    if (fone) userData.external_id = [sha256(fone)]

    const evento: Record<string, unknown> = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: userData,
    }
    if (sourceUrl) evento.event_source_url = sourceUrl
    if (eventId) evento.event_id = eventId

    // custom_data — é AQUI que a Meta aprende que tipo de lead a gente quer.
    // `value` é a alavanca real: com otimização por valor, ela passa a caçar
    // quem se parece com os leads de pontuação alta. As demais propriedades
    // (faixa de faturamento, tamanho do time, nível de dor) não otimizam
    // sozinhas — servem para segmentar, criar públicos e conferir no relatório.
    const custom: Record<string, unknown> = {}
    const valor = Number(body?.value)
    if (Number.isFinite(valor) && valor >= 0) {
      custom.value = valor
      custom.currency = typeof body?.currency === 'string' ? body.currency : 'BRL'
    }
    if (typeof body?.content_name === 'string') custom.content_name = body.content_name
    const perfil = body?.perfil
    if (perfil && typeof perfil === 'object' && !Array.isArray(perfil)) {
      for (const [k, v] of Object.entries(perfil as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) custom[k.slice(0, 40)] = v
        else if (typeof v === 'string' && v) custom[k.slice(0, 40)] = v.slice(0, 100)
      }
    }
    if (Object.keys(custom).length > 0) evento.custom_data = custom

    const res = await fetch(`${GRAPH}/${PIXEL_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [evento], access_token: token }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      console.error('[meta-capi] Meta recusou', res.status, JSON.stringify(data))
      return NextResponse.json({ ok: false }, { status: 502 })
    }
    return NextResponse.json({ ok: true, received: data?.events_received ?? 0 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'capi_error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
