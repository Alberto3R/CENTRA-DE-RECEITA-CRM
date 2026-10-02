import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ============================================================
// GET /api/diagnostico/convite?c=<token> — devolve o pré-preenchimento de
// um convite do Diagnóstico (nome, empresa, WhatsApp e respostas já
// conhecidas da call). Público como o próprio form; o token é o segredo.
// Convite já respondido devolve 410 pra ninguém reenviar por cima.
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

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('c')?.trim() ?? ''
  if (!token) {
    return NextResponse.json({ error: 'Convite ausente.' }, { status: 400 })
  }

  const { data, error } = await admin()
    .from('ccc_convites')
    .select('nome, empresa, whatsapp, respostas, usado_em')
    .eq('token', token)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404 })
  }
  if (data.usado_em) {
    return NextResponse.json({ error: 'Este diagnóstico já foi enviado.' }, { status: 410 })
  }

  return NextResponse.json({
    nome: data.nome ?? '',
    empresa: data.empresa ?? '',
    whatsapp: data.whatsapp ?? '',
    respostas: data.respostas ?? {},
  })
}
