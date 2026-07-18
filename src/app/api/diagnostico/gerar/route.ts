import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { gerarDiagnosticoComando } from '@/lib/ai/ccc-diagnostico'

// ============================================================
// POST /api/diagnostico/gerar — o agente 3R gerador.
//
// Recebe { diagnostico_id, transcricao? }. Lê as respostas do formulário em
// ccc_diagnosticos, junta com a transcrição do kickoff, chama o agente 3R
// (gerarDiagnosticoComando) e grava o resultado em ccc_entregaveis. Marca o
// diagnóstico como processado. Escreve via service role (mesmo padrão de /api/leads).
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const diagnosticoId =
      body && typeof body.diagnostico_id === 'string' ? body.diagnostico_id : ''
    const transcricao =
      body && typeof body.transcricao === 'string' ? body.transcricao : undefined

    if (!diagnosticoId) {
      return NextResponse.json(
        { error: 'diagnostico_id é obrigatório.' },
        { status: 400 },
      )
    }

    // 1. Lê o diagnóstico (respostas do formulário).
    const { data: diag, error: erroLeitura } = await admin()
      .from('ccc_diagnosticos')
      .select('id, account_id, respostas')
      .eq('id', diagnosticoId)
      .single()

    if (erroLeitura || !diag) {
      return NextResponse.json(
        { error: 'Diagnóstico não encontrado.' },
        { status: 404 },
      )
    }

    // 2. O agente 3R gera os entregáveis.
    const resultado = await gerarDiagnosticoComando({
      respostas: (diag.respostas ?? {}) as Record<string, unknown>,
      transcricao,
    })

    // 3. Persiste os entregáveis.
    const { data: salvo, error: erroSalvar } = await admin()
      .from('ccc_entregaveis')
      .insert({
        diagnostico_id: diag.id,
        account_id: diag.account_id,
        entregaveis: resultado.entregaveis,
        conteudo_md: resultado.conteudoMd,
        prompt_versao: resultado.promptVersao,
        uso: resultado.uso,
      })
      .select('id')
      .single()

    if (erroSalvar) {
      return NextResponse.json({ error: erroSalvar.message }, { status: 500 })
    }

    // 4. Marca o diagnóstico como processado.
    await admin()
      .from('ccc_diagnosticos')
      .update({ status: 'processado' })
      .eq('id', diag.id)

    return NextResponse.json({
      ok: true,
      entregavel_id: salvo.id,
      entregaveis: resultado.entregaveis,
      conteudo_md: resultado.conteudoMd,
    })
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Erro ao gerar o diagnóstico.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
