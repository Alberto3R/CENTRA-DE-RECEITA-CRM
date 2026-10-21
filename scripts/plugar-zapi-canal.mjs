/**
 * Cria (ou atualiza) um canal de WhatsApp conectado por QR code (Z-API) numa
 * conta da Central e aponta todos os webhooks da instância para o CRM.
 *
 * Por que é script e não tela: a conta Z-API é da Sales 3R — o token da
 * instância e o Client-Token não passam pela tela do cliente. Depois de
 * rodar, o cliente só vê o QR em Configurações → WhatsApp.
 *
 * Pré-requisitos: migration 120 aplicada e o código do canal QR no ar
 * (senão a Z-API manda eventos para um webhook que ainda não os entende).
 *
 * Uso:
 *   ZAPI_INSTANCE_ID=... ZAPI_TOKEN=... ZAPI_CLIENT_TOKEN=... \
 *   node scripts/plugar-zapi-canal.mjs <account_id> "<nome do canal>"
 *
 * Lê ENCRYPTION_KEY, NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do
 * .env.local (a ENCRYPTION_KEY local é a mesma de produção). Nenhum segredo
 * é impresso.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const SITE = 'https://www.centraldereceita.com.br'

function lerEnv(nome) {
  if (process.env[nome]) return process.env[nome]
  const raw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const m = raw.match(new RegExp(`^${nome}=(.*)$`, 'm'))
  if (!m) throw new Error(`${nome} não encontrado no .env.local`)
  return m[1].trim().replace(/^["']|["']$/g, '')
}

function encrypt(text, keyHex) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv)
  let enc = cipher.update(text, 'utf8', 'hex')
  enc += cipher.final('hex')
  return `${iv.toString('hex')}:${enc}:${cipher.getAuthTag().toString('hex')}`
}

async function zapi(path, { method = 'GET', body } = {}) {
  const res = await fetch(
    `https://api.z-api.io/instances/${INSTANCE}/token/${TOKEN}/${path}`,
    {
      method,
      headers: {
        'Client-Token': CLIENT_TOKEN,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json?.error === 'your client-token is not configured') {
    throw new Error(`Z-API ${path}: ${json?.error || res.status}`)
  }
  return json
}

const [accountId, label] = process.argv.slice(2)
if (!accountId || !label) {
  console.error('Uso: node scripts/plugar-zapi-canal.mjs <account_id> "<nome do canal>"')
  process.exit(1)
}
const INSTANCE = process.env.ZAPI_INSTANCE_ID
const TOKEN = process.env.ZAPI_TOKEN
const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN
if (!INSTANCE || !TOKEN || !CLIENT_TOKEN) {
  console.error('Faltam ZAPI_INSTANCE_ID, ZAPI_TOKEN e ZAPI_CLIENT_TOKEN no ambiente.')
  process.exit(1)
}

const KEY = lerEnv('ENCRYPTION_KEY')
const sb = createClient(lerEnv('NEXT_PUBLIC_SUPABASE_URL'), lerEnv('SUPABASE_SERVICE_ROLE_KEY'))

// 1. Credenciais valem?
const status = await zapi('status')
console.log(`✓ Z-API respondeu (sessão ${status.connected ? 'conectada' : 'aguardando QR'})`)

// 2. Conta e dono
const { data: account, error: accErr } = await sb
  .from('accounts')
  .select('id, name, owner_user_id')
  .eq('id', accountId)
  .maybeSingle()
if (accErr || !account) {
  console.error('✗ Conta não encontrada:', accErr?.message ?? accountId)
  process.exit(1)
}

// 3. Canal (cria ou atualiza pela instância)
const { data: existing } = await sb
  .from('whatsapp_config')
  .select('id, account_id, qr_webhook_secret')
  .eq('qr_instance_id', INSTANCE)
  .maybeSingle()
if (existing && existing.account_id !== accountId) {
  console.error('✗ Esta instância já está ligada a outra conta.')
  process.exit(1)
}
const secret = existing?.qr_webhook_secret ?? crypto.randomBytes(24).toString('hex')
const row = {
  label,
  channel_type: 'whatsapp',
  connection_mode: 'qr',
  qr_provider: 'zapi',
  qr_instance_id: INSTANCE,
  access_token: encrypt(TOKEN, KEY),
  qr_client_token: encrypt(CLIENT_TOKEN, KEY),
  qr_webhook_secret: secret,
  status: status.connected ? 'connected' : 'disconnected',
  updated_at: new Date().toISOString(),
}

let channelId
if (existing) {
  const { error } = await sb.from('whatsapp_config').update(row).eq('id', existing.id)
  if (error) throw new Error(error.message)
  channelId = existing.id
  console.log(`✓ Canal atualizado: ${label}`)
} else {
  const { count } = await sb
    .from('whatsapp_config')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
  const { data, error } = await sb
    .from('whatsapp_config')
    .insert({
      ...row,
      account_id: accountId,
      user_id: account.owner_user_id,
      is_primary: (count ?? 0) === 0,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  channelId = data.id
  console.log(`✓ Canal criado: ${label} (${account.name})`)
}

// 4. Webhooks da instância → CRM (inclui o que for mandado pelo celular)
await zapi('update-every-webhooks', {
  method: 'PUT',
  body: { value: `${SITE}/api/whatsapp/webhook?zapi=${secret}`, notifySentByMe: true },
})
console.log('✓ Webhooks da Z-API apontados para a Central')
console.log(`\nPronto. Canal ${channelId}. O QR aparece em Configurações → WhatsApp.`)
