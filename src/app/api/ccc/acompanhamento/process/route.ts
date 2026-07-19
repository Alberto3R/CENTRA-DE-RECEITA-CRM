import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  detectarGatilhos,
  montarResumoGestor,
  detectarCadencia,
} from '@/lib/ccc/acompanhamento'
import {
  enviarAlertaGestor,
  cobrarVendedor,
  cobrarToqueCadencia,
} from '@/lib/ccc/enviar-alerta'

// ============================================================
// POST /api/ccc/acompanhamento/process — o agente 3R de acompanhamento.
//
// Varre as contas ATIVAS (ccc_acompanhamento_config.ativo=true), detecta os
// pontos de atenção (deals parados, fechamentos vencidos) e:
//   - envia o RESUMO pro WhatsApp do gestor (ccc_alerta_gestor);
//   - COBRA cada vendedor no WhatsApp dele (ccc_followup_atrasado), quando o
//     vendedor tem telefone em sellers.whatsapp.
// Chamado por um pg_cron diário. Auth por x-cron-secret (app_config).
//
// Segurança: só envia quando a conta está `ativo`; contas nascem inativas.
// Body: { account_id?, dry_run? }
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

      const podeEnviar = !dryRun && c.ativo && resumo.total > 0
      const envios: { destino: string; enviado: boolean; motivo?: string }[] = []

      if (podeEnviar) {
        // resumo pro gestor
        if (c.gestor_whatsapp) {
          const r = await enviarAlertaGestor({
            supabase: admin(),
            accountId: c.account_id,
            gestorWhatsapp: c.gestor_whatsapp,
            resumo: mensagem,
          })
          envios.push({ destino: `gestor:${c.gestor_whatsapp}`, enviado: r.ok, motivo: r.reason })
        }

        // cobrança individual por vendedor (quem tem WhatsApp cadastrado)
        for (const v of resumo.por_vendedor) {
          const qtd = v.parados + v.vencidos
          if (!v.whatsapp || qtd === 0) continue
          const r = await cobrarVendedor({
            supabase: admin(),
            accountId: c.account_id,
            vendedorWhatsapp: v.whatsapp,
            vendedorNome: v.vendedor,
            quantidade: qtd,
          })
          envios.push({ destino: `vendedor:${v.vendedor}`, enviado: r.ok, motivo: r.reason })
        }

        if (envios.some((e) => e.enviado)) {
          await admin()
            .from('ccc_acompanhamento_config')
            .update({ ultimo_envio_at: new Date().toISOString() })
            .eq('account_id', c.account_id)
        }
      }

      // Motor de cadência: os toques D+N da régua APROVADA que já venceram
      // por negócio. O agente 3R cobra o vendedor o toque certo na hora certa.
      const toquesDevidos = await detectarCadencia({
        supabase: admin(),
        accountId: c.account_id,
      })
      const cadenciaEnvios: {
        deal: string
        toque: string
        vendedor: string
        enviado: boolean
        motivo?: string
      }[] = []
      if (!dryRun && c.ativo) {
        for (const t of toquesDevidos) {
          if (!t.vendedor_whatsapp) continue
          const r = await cobrarToqueCadencia({
            supabase: admin(),
            accountId: c.account_id,
            vendedorWhatsapp: t.vendedor_whatsapp,
            vendedorNome: t.vendedor_nome,
            lead: t.titulo,
            quando: t.quando,
            acao: t.acao,
          })
          if (r.ok) {
            await admin().from('ccc_cadencia_log').insert({
              account_id: c.account_id,
              deal_id: t.deal_id,
              stage_id: t.stage_id,
              dia_toque: t.dia_toque,
              vendedor_id: t.vendedor_id,
            })
          }
          cadenciaEnvios.push({
            deal: t.titulo,
            toque: t.quando,
            vendedor: t.vendedor_nome,
            enviado: r.ok,
            motivo: r.reason,
          })
        }
        if (cadenciaEnvios.some((e) => e.enviado)) {
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
        por_vendedor: resumo.por_vendedor,
        envios: dryRun ? 'dry_run' : envios,
        cadencia_devida: toquesDevidos.map((t) => ({
          deal: t.titulo,
          vendedor: t.vendedor_nome,
          toque: t.quando,
          acao: t.acao,
          dias_na_etapa: t.dias_na_etapa,
          tem_whatsapp: Boolean(t.vendedor_whatsapp),
        })),
        cadencia_envios: dryRun ? 'dry_run' : cadenciaEnvios,
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
