import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ============================================================
// POST /api/diagnostico — recebe as respostas do Formulário de Diagnóstico
// (Central de Comando Comercial) e grava em `ccc_diagnosticos`.
//
// O form é público (o cliente responde sem sessão), então escrevemos com
// service-role — mesmo padrão de /api/leads. A tabela tem RLS: só service
// role grava; membros da conta leem (quando o diagnóstico já está associado).
// ============================================================

// `any` no client service-role: sem o tipo Database gerado, o supabase-js
// infere `never` nos inserts (mesmo padrão de /api/leads).
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
    }

    const nome = typeof body.nome === 'string' ? body.nome.trim() : ''
    const whatsapp = typeof body.whatsapp === 'string' ? body.whatsapp.trim() : ''
    const empresa = typeof body.empresa === 'string' ? body.empresa.trim() : null
    const respostas =
      body.respostas && typeof body.respostas === 'object' ? body.respostas : {}
    const accountId =
      typeof body.account_id === 'string' && body.account_id ? body.account_id : null

    if (!nome || !whatsapp) {
      return NextResponse.json(
        { error: 'Nome e WhatsApp são obrigatórios.' },
        { status: 400 },
      )
    }

    const { data, error } = await admin()
      .from('ccc_diagnosticos')
      .insert({
        nome,
        empresa,
        whatsapp,
        respostas,
        account_id: accountId,
        origem: 'formulario-web',
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: data.id })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro ao salvar diagnóstico.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
