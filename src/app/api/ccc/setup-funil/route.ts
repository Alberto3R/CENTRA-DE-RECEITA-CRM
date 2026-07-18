import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ============================================================
// POST /api/ccc/setup-funil — o agente 3R de setup do CRM (parte 1: o funil).
//
// Cria o pipeline + as etapas da Central de Comando Comercial numa conta, já
// marcando a etapa de "conversa qualificada" (is_connection = true) — é dela
// que saem as taxas lead→conversa e conversa→venda, independente do canal
// (vídeo/ligação/WhatsApp). Escreve via service role.
//
// Body: { account_id, nome_pipeline?, etapas?: [{ name, is_connection }] }
// ============================================================

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

// Template padrão do funil (ver 02-Operacao/template-funil-padrao.md).
// A etapa 3 é a "conversa qualificada" — marca is_connection = true.
const ETAPAS_PADRAO: { name: string; is_connection: boolean }[] = [
  { name: 'Novo lead', is_connection: false },
  { name: 'Contato feito', is_connection: false },
  { name: 'Conversa qualificada', is_connection: true },
  { name: 'Proposta enviada', is_connection: false },
  { name: 'Ganho', is_connection: false },
  { name: 'Perdido', is_connection: false },
]

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const accountId =
      body && typeof body.account_id === 'string' ? body.account_id : ''
    const nomePipeline =
      body && typeof body.nome_pipeline === 'string' && body.nome_pipeline.trim()
        ? body.nome_pipeline.trim()
        : 'Comercial 3R'
    const etapas: { name: string; is_connection: boolean }[] =
      body && Array.isArray(body.etapas) && body.etapas.length > 0
        ? body.etapas.map((e: { name?: string; is_connection?: boolean }) => ({
            name: String(e?.name ?? '').trim(),
            is_connection: Boolean(e?.is_connection),
          }))
        : ETAPAS_PADRAO

    if (!accountId) {
      return NextResponse.json(
        { error: 'account_id é obrigatório.' },
        { status: 400 },
      )
    }
    if (etapas.some((e) => !e.name)) {
      return NextResponse.json(
        { error: 'Toda etapa precisa de um nome.' },
        { status: 400 },
      )
    }

    // pipelines.user_id é NOT NULL — usamos o owner da conta.
    const { data: owner, error: erroOwner } = await admin()
      .from('account_members')
      .select('user_id')
      .eq('account_id', accountId)
      .eq('role', 'owner')
      .limit(1)
      .single()

    if (erroOwner || !owner) {
      return NextResponse.json(
        { error: 'Conta sem owner — não é possível criar o funil.' },
        { status: 404 },
      )
    }

    // 1. Cria o pipeline.
    const { data: pipeline, error: erroPipeline } = await admin()
      .from('pipelines')
      .insert({
        account_id: accountId,
        user_id: owner.user_id,
        name: nomePipeline,
      })
      .select('id')
      .single()

    if (erroPipeline) {
      return NextResponse.json({ error: erroPipeline.message }, { status: 500 })
    }

    // 2. Cria as etapas (com a "conversa qualificada" marcada).
    const stages = etapas.map((e, i) => ({
      pipeline_id: pipeline.id,
      name: e.name,
      position: i,
      is_connection: e.is_connection,
    }))

    const { error: erroStages } = await admin()
      .from('pipeline_stages')
      .insert(stages)

    if (erroStages) {
      return NextResponse.json({ error: erroStages.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      pipeline_id: pipeline.id,
      nome: nomePipeline,
      etapas: stages.map((s) => ({ name: s.name, is_connection: s.is_connection })),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro ao criar o funil.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
