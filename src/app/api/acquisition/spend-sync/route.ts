import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { syncSpend } from '@/lib/acquisition/spend-sync'

// ============================================================
// POST /api/acquisition/spend-sync — puxa o gasto de mídia (Meta) para
// ad_spend_daily (migration 113).
//
// Dois chamadores:
//  - pg_cron a cada 6 h (x-cron-secret == app_config 'leadgen_cron_secret',
//    o mesmo segredo das rotas do Lead Ads) → todas as contas ativas;
//  - botão "Sincronizar agora" em Configurações → Aquisição → só a conta
//    ativa do usuário, e só se ele for admin dela.
// ============================================================

export const maxDuration = 300

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export async function POST(request: Request) {
  const db = admin()

  const cronHeader = request.headers.get('x-cron-secret')
  if (cronHeader) {
    const { data: secretRow } = await db
      .from('app_config')
      .select('value')
      .eq('key', 'leadgen_cron_secret')
      .maybeSingle()
    const secret = (secretRow as { value?: string } | null)?.value
    if (!secret || cronHeader !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const summary = await syncSpend(db)
    return NextResponse.json(summary)
  }

  // Disparo manual: usuário logado, admin da conta ativa.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return NextResponse.json({ error: 'no account' }, { status: 403 })
  const { data: isAdmin } = await supabase.rpc('is_account_member', {
    target_account_id: accountId,
    min_role: 'admin',
  })
  if (!isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const summary = await syncSpend(db, { accountId })
  return NextResponse.json(summary)
}
