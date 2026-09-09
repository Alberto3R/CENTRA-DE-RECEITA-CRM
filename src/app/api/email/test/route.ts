/**
 * Teste de conexão do canal de e-mail — o botão "Testar conexão".
 *
 * Testa SMTP e IMAP SEPARADAMENTE e devolve os dois veredictos. Separar importa:
 * no Zoho o SMTP pode autenticar perfeitamente enquanto o IMAP está desligado
 * por configuração. Um teste único diria só "falhou" e mandaria o operador
 * caçar a senha errada — quando o problema é uma opção no painel.
 *
 * Descobrir isso aqui é o ponto: uma trava de IMAP que aparece só quando a
 * primeira resposta de um lead não chega é cara demais.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toEmailChannel } from '@/lib/email/config'
import { verificarSMTP } from '@/lib/email/outbound'
import { verificarIMAP } from '@/lib/email/inbound'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: perfil } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!perfil?.account_id) {
    return NextResponse.json({ error: 'Perfil sem conta' }, { status: 403 })
  }

  const { id } = (await request.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id do canal é obrigatório' }, { status: 400 })

  const { data: linha } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('id', id)
    .eq('account_id', perfil.account_id)
    .eq('channel_type', 'email')
    .maybeSingle()

  if (!linha) return NextResponse.json({ error: 'Canal não encontrado' }, { status: 404 })

  let canal
  try {
    canal = toEmailChannel(linha)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Canal mal configurado' },
      { status: 400 },
    )
  }

  // Os dois em paralelo: são independentes e cada um leva alguns segundos.
  const [smtp, imap] = await Promise.all([verificarSMTP(canal), verificarIMAP(canal)])

  return NextResponse.json({
    envio: smtp.ok
      ? { ok: true, detalhe: `Autenticado em ${canal.smtpHost}:${canal.smtpPort}` }
      : { ok: false, detalhe: smtp.erro },
    recebimento: imap.ok
      ? { ok: true, detalhe: `INBOX acessível (${imap.mensagens ?? 0} mensagens)` }
      : { ok: false, detalhe: imap.erro },
    // O canal serve pra prospecção mesmo só com o envio — mas sem IMAP as
    // respostas não aparecem no CRM, que é metade do valor.
    pronto: smtp.ok && imap.ok,
  })
}
