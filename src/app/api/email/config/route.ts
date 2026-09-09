/**
 * Configuração do canal de e-mail (channel_type='email', migration 091).
 *
 * Por que existe uma rota em vez de o componente falar direto com o Supabase
 * (como faz o `instagram-settings.tsx`): a senha de app precisa ser CIFRADA, e
 * a `ENCRYPTION_KEY` é server-side. A senha nunca pode transitar de volta para
 * o cliente nem aparecer em log — este handler é a única porta.
 *
 * Nota do Next 16.2.6: `runtime` já é 'nodejs' por default, então nada a
 * declarar. Só não marcar 'edge' aqui — o teste de conexão usa sockets TCP.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/whatsapp/encryption'
import { EMAIL_PROVIDER_DEFAULTS, DEFAULT_DAILY_SEND_LIMIT } from '@/lib/email/config'

/** Colunas seguras de devolver ao cliente. `access_token` JAMAIS entra aqui. */
const CAMPOS_PUBLICOS =
  'id,label,status,email_address,email_provider,smtp_host,smtp_port,' +
  'imap_host,imap_port,daily_send_limit,last_poll_at,connected_at,created_at'

async function contexto(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { erro: 'Unauthorized' as const, status: 401 }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!perfil?.account_id) {
    return { erro: 'Perfil sem conta vinculada' as const, status: 403 }
  }
  return {
    userId: user.id,
    accountId: perfil.account_id as string,
    role: (perfil.account_role ?? 'viewer') as string,
  }
}

const podeEscrever = (role: string) => role === 'owner' || role === 'admin'

// ── GET: lista os canais de e-mail da conta ativa ───────────────────────────
export async function GET() {
  const supabase = await createClient()
  const ctx = await contexto(supabase)
  if ('erro' in ctx) return NextResponse.json({ error: ctx.erro }, { status: ctx.status })

  const { data, error } = await supabase
    .from('whatsapp_config')
    .select(CAMPOS_PUBLICOS)
    .eq('account_id', ctx.accountId)
    .eq('channel_type', 'email')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[GET /api/email/config]', error)
    return NextResponse.json({ error: 'Falha ao carregar canais' }, { status: 500 })
  }
  return NextResponse.json({ canais: data ?? [] })
}

// ── POST: cria ou atualiza um canal ─────────────────────────────────────────
export async function POST(request: Request) {
  const supabase = await createClient()
  const ctx = await contexto(supabase)
  if ('erro' in ctx) return NextResponse.json({ error: ctx.erro }, { status: ctx.status })
  if (!podeEscrever(ctx.role)) {
    return NextResponse.json(
      { error: 'Só owner ou admin pode configurar canais' },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

  const {
    id,
    label,
    emailAddress,
    provider = 'zoho',
    senha,
    dailySendLimit,
    smtpHost,
    smtpPort,
    imapHost,
    imapPort,
  } = body as Record<string, string | number | undefined>

  const endereco = String(emailAddress ?? '').trim().toLowerCase()
  if (!endereco.includes('@')) {
    return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 })
  }

  const chave = String(provider).toLowerCase()
  const padroes = EMAIL_PROVIDER_DEFAULTS[chave] ?? EMAIL_PROVIDER_DEFAULTS.zoho

  const registro: Record<string, unknown> = {
    account_id: ctx.accountId,
    channel_type: 'email',
    label: label ? String(label) : 'E-mail',
    email_address: endereco,
    email_provider: chave,
    smtp_host: smtpHost || padroes.smtpHost,
    smtp_port: Number(smtpPort) || padroes.smtpPort,
    imap_host: imapHost || padroes.imapHost,
    imap_port: Number(imapPort) || padroes.imapPort,
    daily_send_limit: Number(dailySendLimit) || DEFAULT_DAILY_SEND_LIMIT,
  }

  // A senha só é gravada quando vem preenchida. Editar o rótulo ou o teto não
  // pode apagar a credencial de quem já está conectado.
  if (senha) {
    registro.access_token = encrypt(String(senha))
    registro.status = 'connected'
    registro.connected_at = new Date().toISOString()
  }

  if (id) {
    const { data, error } = await supabase
      .from('whatsapp_config')
      .update(registro)
      .eq('id', String(id))
      .eq('account_id', ctx.accountId)
      .eq('channel_type', 'email')
      .select(CAMPOS_PUBLICOS)
      .maybeSingle()

    if (error) {
      console.error('[POST /api/email/config] update', error)
      return NextResponse.json({ error: 'Falha ao salvar' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Canal não encontrado' }, { status: 404 })
    return NextResponse.json({ canal: data })
  }

  // Canal novo exige senha — sem credencial ele não envia nada.
  if (!senha) {
    return NextResponse.json(
      { error: 'Senha de app é obrigatória para conectar um canal novo' },
      { status: 400 },
    )
  }
  registro.user_id = ctx.userId
  registro.is_primary = false // e-mail nunca vira o canal primário da conta

  const { data, error } = await supabase
    .from('whatsapp_config')
    .insert(registro)
    .select(CAMPOS_PUBLICOS)
    .maybeSingle()

  if (error) {
    console.error('[POST /api/email/config] insert', error)
    const duplicado = error.message?.includes('whatsapp_config_email_unique')
    return NextResponse.json(
      { error: duplicado ? 'Esta caixa já está conectada' : 'Falha ao criar canal' },
      { status: duplicado ? 409 : 500 },
    )
  }
  return NextResponse.json({ canal: data }, { status: 201 })
}

// ── DELETE: remove um canal ─────────────────────────────────────────────────
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const ctx = await contexto(supabase)
  if ('erro' in ctx) return NextResponse.json({ error: ctx.erro }, { status: ctx.status })
  if (!podeEscrever(ctx.role)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

  const { error } = await supabase
    .from('whatsapp_config')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .eq('channel_type', 'email')

  if (error) {
    console.error('[DELETE /api/email/config]', error)
    return NextResponse.json({ error: 'Falha ao remover' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
