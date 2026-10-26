/**
 * Saneamento de um canal de WhatsApp por QR code (Z-API) depois do conserto
 * de LID e Status (migration 122 + webhook novo).
 *
 * Antes do conserto, o webhook:
 *   1. abria um contato SEM telefone para cada Status (story) dos contatos do
 *      celular — "Eliene", "Manu Marques"… uma conversa por story;
 *   2. gravava o LID do WhatsApp (14–15 dígitos, "171459523662078") no lugar
 *      do telefone, e a resposta que o vendedor mandou pelo celular caía numa
 *      conversa fantasma em vez da conversa do cliente.
 *
 * O script NÃO ESCREVE NADA. Ele lê o banco, pergunta à Z-API o LID de cada
 * contato com telefone do canal ("Is on WhatsApp?" — telefone → LID; o
 * contrário não existe) e gera um arquivo .sql, numa transação, com:
 *   - FUSÃO: conversa do LID → conversa do cliente com quem o LID casou
 *     (mensagens, negócios, notas, etiquetas…), e o LID fica no cliente;
 *   - LID SEM DONO: o contato fica, mas o LID sai do telefone e vai para
 *     `wa_lid` (o próximo eco já cai nele; a Central responde pelo LID);
 *   - com --limpar-status: apaga os contatos sem telefone que só têm Status
 *     (sem negócio, nota, etiqueta, e-mail, Instagram, nem mensagem nossa).
 * Quem aplica é uma pessoa, depois de ler o .sql (SQL Editor do Supabase).
 *
 * Pré-requisito para APLICAR o .sql: migration 122 (contacts.wa_lid).
 *
 * Uso:
 *   node scripts/saneia-lid-e-status-qr.mjs <channel_id> [--limpar-status] [--sql <arquivo>]
 *
 * Lê ENCRYPTION_KEY, NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do
 * ambiente ou do .env.local. Nenhum segredo é impresso.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function lerEnv(nome) {
  if (process.env[nome]) return process.env[nome]
  const raw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const m = raw.match(new RegExp(`^${nome}=(.*)$`, 'm'))
  if (!m) throw new Error(`${nome} não encontrado no .env.local`)
  return m[1].trim().replace(/^["']|["']$/g, '')
}

/** Mesmo formato de src/lib/whatsapp/encryption (iv:cifra:tag, AES-256-GCM). */
function decrypt(texto, keyHex) {
  const [ivHex, encHex, tagHex] = texto.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(encHex, 'hex', 'utf8') + decipher.final('utf8')
}

// ── argumentos ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const CHANNEL_ID = args.find((a) => !a.startsWith('--'))
const LIMPAR_STATUS = args.includes('--limpar-status')
const sqlIdx = args.indexOf('--sql')
const SQL_PATH = sqlIdx >= 0 ? args[sqlIdx + 1] : `saneamento-qr-${CHANNEL_ID?.slice(0, 8)}.sql`
if (!CHANNEL_ID) {
  console.error('Uso: node scripts/saneia-lid-e-status-qr.mjs <channel_id> [--limpar-status] [--sql <arquivo>]')
  process.exit(1)
}

const db = createClient(lerEnv('NEXT_PUBLIC_SUPABASE_URL'), lerEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

/** LID gravado no lugar do telefone: 14–15 dígitos (telefone BR com 55 tem 12–13). */
const pareceLid = (phone) => /^\d{14,15}$/.test(phone ?? '')
const temTelefone = (phone) => /^\d{10,13}$/.test(phone ?? '')
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

// ── canal ───────────────────────────────────────────────────────────────────
const { data: canal, error: errCanal } = await db
  .from('whatsapp_config')
  .select('id, account_id, connection_mode, qr_instance_id, access_token, qr_client_token, label')
  .eq('id', CHANNEL_ID)
  .maybeSingle()
if (errCanal || !canal) throw new Error(`canal ${CHANNEL_ID} não encontrado`)
if (canal.connection_mode !== 'qr') throw new Error('o canal não é de QR code (Z-API)')
const ACC = canal.account_id
const KEY = lerEnv('ENCRYPTION_KEY')
const INSTANCE = canal.qr_instance_id
const TOKEN = decrypt(canal.access_token, KEY)
const CLIENT_TOKEN = decrypt(canal.qr_client_token, KEY)

async function lidDoTelefone(phone) {
  const res = await fetch(`https://api.z-api.io/instances/${INSTANCE}/token/${TOKEN}/phone-exists/${phone}`, {
    headers: { 'Client-Token': CLIENT_TOKEN },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`Z-API phone-exists: ${json?.error || res.status}`)
  const item = Array.isArray(json) ? json[0] : json
  if (!item?.exists || !item.lid) return null
  const d = String(item.lid).replace(/\D/g, '')
  return d ? `${d}@lid` : null
}

// ── contatos do canal ───────────────────────────────────────────────────────
const { data: convs, error: errConvs } = await db
  .from('conversations')
  .select('id, contact_id, last_message_at, contact:contacts(*)')
  .eq('account_id', ACC)
  .eq('channel_id', CHANNEL_ID)
if (errConvs) throw new Error(errConvs.message)

const contatos = new Map()
for (const c of convs ?? []) if (c.contact) contatos.set(c.contact.id, c.contact)

async function contarMensagens(contactId) {
  const ids = (convs ?? []).filter((c) => c.contact_id === contactId).map((c) => c.id)
  if (ids.length === 0) return { total: 0, nossas: 0 }
  const { data } = await db.from('messages').select('sender_type').in('conversation_id', ids)
  return {
    total: data?.length ?? 0,
    nossas: (data ?? []).filter((m) => m.sender_type !== 'customer').length,
  }
}

// ── 1. LID de cada contato com telefone ─────────────────────────────────────
const donoDoLid = new Map()
for (const c of contatos.values()) {
  if (c.wa_lid) donoDoLid.set(c.wa_lid, c)
}
const comTelefone = [...contatos.values()].filter((c) => temTelefone(c.phone) && !c.wa_lid)
console.log(`Perguntando à Z-API o LID de ${comTelefone.length} contato(s) com telefone…`)
const lidNovo = new Map() // contact.id → lid descoberto agora
for (const c of comTelefone) {
  try {
    const lid = await lidDoTelefone(c.phone)
    if (lid) {
      lidNovo.set(c.id, lid)
      if (!donoDoLid.has(lid)) donoDoLid.set(lid, c)
    }
  } catch (err) {
    console.warn(`  ${c.name} (${c.phone}): ${err.message}`)
  }
  await new Promise((r) => setTimeout(r, 300))
}

// ── 2. plano ────────────────────────────────────────────────────────────────
const fusoes = []
const semDono = []
for (const c of contatos.values()) {
  if (!pareceLid(c.phone)) continue
  const lid = `${c.phone}@lid`
  const dono = donoDoLid.get(lid)
  const msgs = await contarMensagens(c.id)
  if (dono && dono.id !== c.id) fusoes.push({ perdedor: c, dono, lid, msgs })
  else semDono.push({ contato: c, lid, msgs })
}

const status = []
if (LIMPAR_STATUS) {
  for (const c of contatos.values()) {
    if ((c.phone ?? '') !== '' || c.wa_lid || c.instagram_id || c.email) continue
    const msgs = await contarMensagens(c.id)
    if (msgs.nossas > 0) continue
    const [{ count: deals }, { count: notas }, { count: tags }] = await Promise.all([
      db.from('deals').select('id', { count: 'exact', head: true }).eq('contact_id', c.id),
      db.from('contact_notes').select('id', { count: 'exact', head: true }).eq('contact_id', c.id),
      db.from('contact_tags').select('contact_id', { count: 'exact', head: true }).eq('contact_id', c.id),
    ])
    if ((deals ?? 0) + (notas ?? 0) + (tags ?? 0) > 0) continue
    status.push({ contato: c, msgs })
  }
}

// ── 3. SQL ──────────────────────────────────────────────────────────────────
// Filhos que apontam para o contato (FKs de public.contacts, 26/out/2026).
const FILHOS_SIMPLES = [
  'contact_notes', 'deals', 'broadcast_recipients', 'automation_logs',
  'automation_pending_executions', 'lead_attribution', 'sdr_activities',
  'whatsapp_calls', 'scheduled_calls', 'telnyx_calls', 'meta_leadgen_leads',
  'scheduled_messages', 'outbound_touches', 'ai_agente_avaliacoes',
]

function sqlFusao({ perdedor: L, dono: S, lid }) {
  const filhos = FILHOS_SIMPLES.map(
    (t) => `  update public.${t} set contact_id = ${q(S.id)} where contact_id = ${q(L.id)};`,
  ).join('\n')
  return `-- ${S.name} (${S.phone}) ← contato-LID ${L.phone}
do $$
declare v_conv uuid;
begin
  select id into v_conv from public.conversations
   where account_id = ${q(ACC)} and contact_id = ${q(S.id)} and channel_id = ${q(CHANNEL_ID)};
  if v_conv is null then
    -- O cliente ainda não tinha conversa neste canal: a do LID passa a ser dele.
    update public.conversations set contact_id = ${q(S.id)}
     where account_id = ${q(ACC)} and contact_id = ${q(L.id)} and channel_id = ${q(CHANNEL_ID)};
  else
    update public.messages m set conversation_id = v_conv
      from public.conversations lc
     where lc.contact_id = ${q(L.id)} and lc.channel_id = ${q(CHANNEL_ID)} and m.conversation_id = lc.id
       and not exists (select 1 from public.messages x
                        where x.conversation_id = v_conv and x.message_id = m.message_id);
    update public.conversations c
       set last_message_at = t.created_at,
           last_message_text = coalesce(t.content_text, '[' || t.content_type || ']'),
           updated_at = now()
      from (select created_at, content_text, content_type from public.messages
             where conversation_id = v_conv order by created_at desc limit 1) t
     where c.id = v_conv;
  end if;
  -- Conversas do LID em outros canais (não deveria haver): só se o cliente não tiver lá.
  update public.conversations lc set contact_id = ${q(S.id)}
   where lc.contact_id = ${q(L.id)}
     and not exists (select 1 from public.conversations s
                      where s.contact_id = ${q(S.id)} and s.channel_id is not distinct from lc.channel_id);
${filhos}
  update public.contact_tags ct set contact_id = ${q(S.id)}
   where ct.contact_id = ${q(L.id)}
     and not exists (select 1 from public.contact_tags s where s.contact_id = ${q(S.id)} and s.tag_id = ct.tag_id);
  update public.contact_custom_values cv set contact_id = ${q(S.id)}
   where cv.contact_id = ${q(L.id)}
     and not exists (select 1 from public.contact_custom_values s
                      where s.contact_id = ${q(S.id)} and s.custom_field_id = cv.custom_field_id);
  update public.flow_runs set contact_id = ${q(S.id)} where contact_id = ${q(L.id)} and status <> 'active';
  delete from public.contacts where id = ${q(L.id)} and account_id = ${q(ACC)};
  update public.contacts set wa_lid = ${q(lid)}, updated_at = now()
   where id = ${q(S.id)} and wa_lid is null;
end $$;`
}

const linhas = [
  `-- Saneamento do canal QR ${CHANNEL_ID} (conta ${ACC})`,
  `-- Gerado por scripts/saneia-lid-e-status-qr.mjs em ${new Date().toISOString()}`,
  '-- Pré-requisito: migration 122 (contacts.wa_lid). Revise antes de aplicar.',
  '',
  'begin;',
  '',
  `-- 1) FUSÕES: ${fusoes.length}`,
  ...fusoes.map(sqlFusao),
  '',
  '-- 2) LID descoberto para contatos com telefone (o próximo eco já casa)',
  ...[...lidNovo].map(
    ([id, lid]) =>
      `update public.contacts set wa_lid = ${q(lid)}, updated_at = now() where id = ${q(id)} and wa_lid is null` +
      ` and not exists (select 1 from public.contacts o where o.account_id = ${q(ACC)} and o.wa_lid = ${q(lid)});`,
  ),
  '',
  `-- 3) LID SEM DONO: ${semDono.length} — sai do telefone, vai para wa_lid`,
  ...semDono.map(
    ({ contato: c, lid }) =>
      `update public.contacts set phone = null, wa_lid = ${q(lid)}, updated_at = now()` +
      ` where id = ${q(c.id)} and phone = ${q(c.phone)} and wa_lid is null; -- ${c.name}`,
  ),
  '',
]
if (LIMPAR_STATUS) {
  linhas.push(
    `-- 4) STATUS (stories) que viraram contato: ${status.length} — apaga contato, conversa e mensagens`,
    '--    Os arquivos copiados para o bucket chat-media ficam (limpar à parte, se quiser).',
    ...status.map(
      ({ contato: c, msgs }) =>
        `delete from public.contacts where id = ${q(c.id)} and account_id = ${q(ACC)}` +
        ` and coalesce(phone, '') = '' and wa_lid is null; -- ${c.name} (${msgs.total} msg)`,
    ),
    '',
  )
}
linhas.push('commit;', '')
fs.writeFileSync(SQL_PATH, linhas.join('\n'))

// ── 4. relatório ────────────────────────────────────────────────────────────
console.log(`\nCanal ${canal.label ?? CHANNEL_ID} — conta ${ACC}`)
console.log(`\nFUSÕES (${fusoes.length}): conversa do LID → conversa do cliente`)
for (const f of fusoes) {
  console.log(`  ${f.perdedor.phone} (${f.msgs.total} msg) → ${f.dono.name} ${f.dono.phone}`)
}
console.log(`\nLID SEM DONO (${semDono.length}): ficam como contato só com LID`)
for (const s of semDono) console.log(`  ${s.contato.phone} "${s.contato.name}" (${s.msgs.total} msg)`)
console.log(`\nLID descoberto para ${lidNovo.size} contato(s) com telefone.`)
if (LIMPAR_STATUS) {
  const total = status.reduce((n, s) => n + s.msgs.total, 0)
  console.log(`\nSTATUS a apagar: ${status.length} contato(s), ${total} mensagem(ns)`)
}
console.log(`\nSQL para revisar: ${SQL_PATH} (nada foi gravado no banco)`)
