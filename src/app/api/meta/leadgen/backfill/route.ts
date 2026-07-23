import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { backfillFromForms } from '@/lib/meta/leadgen-import'

// ============================================================
// POST /api/meta/leadgen/backfill — rede de segurança do Lead Ads.
//
// Varre os formulários das páginas configuradas na Graph e importa
// qualquer lead que ainda não esteja no CRM (idempotente por leadgen_id).
// Cobre: webhook não entregue, leitura bloqueada por Leads Access na hora
// do evento (a Meta NÃO reentrega), e qualquer outro soluço.
//
// Chamado por pg_cron a cada 10 min (migration 080). Auth: x-cron-secret
// == app_config('leadgen_cron_secret') — mesmo segredo do worker de
// conversões.
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

export async function POST(request: Request) {
  const db = admin()
  const { data: secretRow } = await db
    .from('app_config')
    .select('value')
    .eq('key', 'leadgen_cron_secret')
    .maybeSingle()
  const secret = (secretRow as { value?: string } | null)?.value
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const summary = await backfillFromForms(db)
    return NextResponse.json({ ok: true, summary })
  } catch (err) {
    console.error('[leadgen-backfill] falhou:', err)
    return NextResponse.json({ ok: false, error: 'backfill_failed' }, { status: 500 })
  }
}
