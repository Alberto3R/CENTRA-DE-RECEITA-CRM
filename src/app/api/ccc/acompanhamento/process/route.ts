import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectarGatilhos, montarResumoGestor } from '@/lib/ccc/acompanhamento'
import { enviarAlertaGestor } from '@/lib/ccc/enviar-alerta'

// ============================================================
// POST /api/ccc/acompanhamento/process — o agente 3R de acompanhamento.
//
// Varre o funil das contas ATIVAS (ccc_acompanhamento_config.ativo = true),
// detecta os pontos de atenção (deals parados, fechamentos vencidos) e envia
// o resumo pro WhatsApp do gestor via o template HSM `ccc_alerta_gestor`.
// Chamado por um pg_cron diário (migration 070). Auth por x-cron-secret
// (segredo em app_config, padrão da migration 055).
//
// Segurança: só envia quando a conta está `ativo` E tem `gestor_whatsapp` E há
// algo a reportar. Contas nascem inativas → nada é enviado sem opt-in.
//
// Body: { account_id?, dry_run? }
//   - account_id ausente → varre todas as contas ativas (uso do cron).
//   - dry_run: true      → detecta e retorna, sem enviar (teste).
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

async function segredoValido(headerSecret: string | null): Promise<boolean> {
  if (!headerSecret) return false
  const { data } = await admin()
    .from('app_config')
    .select('value')
    .eq('key', 'ccc_cron_secret')
    .single()
  return Boolean(data?.value) && data.value === headerSecret
}

interface ContaConfig {
  account_id: string
  gestor_whatsapp: string | null
  dias_parado: number
  ativo: boolean
}

export async function POST(req: Request) {
  try {
    if (!(await segredoValido(req.headers.get('x-cron-secret')))) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const accountId =
      body && typeof body.account_id === 'string' ? body.account_id : null
    const dryRun = body?.dry_run === true

    // Contas a processar.
    let contas: ContaConfig[]
    if (accountId) {
      const { data } = await admin()
        .from('ccc_acompanhamento_config')
        .select('account_id, gestor_whatsapp, dias_parado, ativo')
        .eq('account_id', accountId)
      contas =
        data && data.length > 0
          ? (data as ContaConfig[])
          : [{ account_id: accountId, gestor_whatsapp: null, dias_parado: 5, ativo: false }]
    } else {
      const { data } = await admin()
        .from('ccc_acompanhamento_config')
        .select('account_id, gestor_whatsapp, dias_parado, ativo')
        .eq('ativo', true)
      contas = (data ?? []) as ContaConfig[]
    }

    const resultados: unknown[] = []
    for (const c of contas) {
      const resumo = await detectarGatilhos({
        supabase: admin(),
        accountId: c.account_id,
        diasParado: c.dias_parado,
      })
      const mensagem = montarResumoGestor(resumo)

      let envio: { enviado: boolean; motivo?: string } = {
        enviado: false,
        motivo: dryRun ? 'dry_run' : 'inativo_ou_sem_gestor_ou_nada_a_reportar',
      }

      const podeEnviar =
        !dryRun && c.ativo && !!c.gestor_whatsapp && resumo.total > 0
      if (podeEnviar) {
        const r = await enviarAlertaGestor({
          supabase: admin(),
          accountId: c.account_id,
          gestorWhatsapp: c.gestor_whatsapp as string,
          resumo: mensagem,
        })
        envio = { enviado: r.ok, motivo: r.reason }
        if (r.ok) {
          await admin()
            .from('ccc_acompanhamento_config')
            .update({ ultimo_envio_at: new Date().toISOString() })
            .eq('account_id', c.account_id)
        }
      }

      resultados.push({
        account_id: c.account_id,
        total: resumo.total,
        mensagem_gestor: mensagem,
        envio,
      })
    }

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      contas: resultados.length,
      resultados,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro no acompanhamento.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
