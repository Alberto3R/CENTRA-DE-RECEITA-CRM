import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectarGatilhos, montarResumoGestor } from '@/lib/ccc/acompanhamento'

// ============================================================
// POST /api/ccc/acompanhamento/process — o agente 3R de acompanhamento.
//
// Varre o funil de uma conta e detecta os pontos de atenção (deals parados,
// fechamentos vencidos). Protegido por x-cron-secret (mesmo padrão dos crons
// do CRM), pra ser chamado por um pg_cron diário (fase 4b).
//
// **DRY-RUN por padrão**: retorna o que o gestor receberia, SEM disparar
// WhatsApp. O envio real depende de (a) o WhatsApp do gestor/vendedor
// configurado por conta e (b) os templates HSM ccc_* aprovados — ver nota.
//
// Body: { account_id, dias_parado? }
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
    // Auth por segredo — mesmo esquema dos crons existentes (AUTOMATION_CRON_SECRET).
    const secret = req.headers.get('x-cron-secret')
    if (
      !process.env.AUTOMATION_CRON_SECRET ||
      secret !== process.env.AUTOMATION_CRON_SECRET
    ) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const accountId =
      body && typeof body.account_id === 'string' ? body.account_id : ''
    const diasParado =
      body && typeof body.dias_parado === 'number' ? body.dias_parado : undefined

    if (!accountId) {
      return NextResponse.json(
        { error: 'account_id é obrigatório.' },
        { status: 400 },
      )
    }

    const resumo = await detectarGatilhos({
      supabase: admin(),
      accountId,
      diasParado,
    })

    // DRY-RUN: por enquanto só devolve o diagnóstico do funil. O disparo real
    // no WhatsApp entra na fase 4b (precisa do número do gestor por conta e/ou
    // do telefone de cada vendedor — que o CRM ainda não guarda).
    return NextResponse.json({
      ok: true,
      dry_run: true,
      resumo,
      mensagem_gestor: montarResumoGestor(resumo),
    })
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Erro no acompanhamento.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
