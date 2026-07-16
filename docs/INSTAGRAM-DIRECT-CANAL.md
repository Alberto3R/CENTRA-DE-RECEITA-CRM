# Instagram Direct como canal no CRM

Plano para receber e responder **DMs do Instagram** dentro do CRM (Central de Receita), como mais um canal ao lado do WhatsApp. Espelha a arquitetura multi-canal existente (`whatsapp_config` = tabela de canais, `conversations.channel_id`, engines de automação/IA).

> **Escopo:** o **inbox de DM** (mensagens diretas). Não confundir com o **comment-to-DM** (comentário → resposta automática), que já roda na Edge Function `ig-comment-webhook`. Compartilham o mesmo App/token/webhook. Ver seção 8.

---

## ✅ STATUS / ponto de partida (provado em 16/jul/2026)

**A viabilidade está 100% PROVADA ao vivo, em Standard access, SEM App Review.** O que falta é só o build no wacrm.

| Capacidade | Estado | Como foi provado |
|---|---|---|
| **Enviar DM** | ✅ funciona | `POST /{PAGE_ID}/messages` (Messenger Platform). Testado: private-reply de comentário (augra.rt, karol) + resposta na janela de 24h (augra.rt). |
| **Receber DM** | ✅ funciona | Campo `messages` do webhook JÁ assinado. DM da AUGRA chegou e foi logado em `ig_dm_events`. |
| **Responder dentro de 24h** | ✅ funciona | Resposta enviada pro IGSID da AUGRA (`recipient.id`), retornou `message_id`. |
| **Responder depois de 24h** (human_agent) | ⚠️ precisa App Review | Só pra retomar conversa fria. App Review está montado mas **NÃO enviado** (parado, opcional). |

**Descoberta-chave:** o erro `(#3) Application does not have the capability` era **endpoint errado**, não falta de acesso. O app é Facebook-Login/Página → envio pelo **Messenger Platform `/{PAGE_ID}/messages`**, NUNCA `/{IG_ID}/messages` (esse é da variante Instagram-Login). O erro `(#10) fora do período` = só janela, não permissão.

### Já montado no Supabase (mesmo projeto do CRM: `uymmbqockiqcpporluxk`)
- **Webhook `instagram`** assinado nos campos `comments, live_comments, mentions, messages` (ativo). Callback = Edge Function `ig-comment-webhook`.
- **Edge Function `ig-comment-webhook` (v4)** — trata `entry[].changes[]` (comentários → comment-to-DM) E `entry[].messaging[]` (DMs → loga em `ig_dm_events`). Valida HMAC. Token via secret `IG_TOKEN` → page token.
- **Tabela `ig_dm_events`** (`mid, sender_id, text, is_echo, raw, created_at`) — hoje só loga as DMs recebidas (fundação da ingestão).
- Send helper de referência: `POST https://graph.facebook.com/v22.0/{PAGE_ID}/messages?access_token={PAGE_TOKEN}` com `{recipient:{id:<IGSID>}, message:{text}}`. Page token = `GET /{PAGE_ID}?fields=access_token&access_token={IG_TOKEN}`.

### O que falta (o build no wacrm)
Trazer o DM pra dentro das tabelas do CRM (`contacts`/`conversations`/`messages`) e mostrar/responder no inbox. Seções 2–5 e 9.

---

## 1. Pré-requisitos (Meta) — todos OK

- App "Sales 3R API" (`1005742594569109`) publicado (Ao vivo). Token de system user com os scopes (`instagram_manage_messages`, `pages_messaging`, etc.).
- Conta IG comercial `@albertooliveiran` (`17841439327821349`) conectada via Página `152902442083026`. "Permitir acesso a mensagens" ligado.
- Webhook `instagram`/`messages` **já assinado** (seção 6). App Secret 3R (`***REMOVED-APP-SECRET***`) já está no `META_APP_SECRET` da Vercel.
- **App Review NÃO é pré-requisito** do inbox básico (receber + responder ≤24h). Só necessário pro human_agent (>24h). Kit do review (se quiserem retomar depois) em `Conteúdos Instagram/app-review/KIT-APP-REVIEW.md`.

---

## 2. O que muda no modelo de dados

Canal hoje é WhatsApp-específico (`whatsapp_config` com `phone_number_id`, WABA) e contato é por **telefone**. Instagram usa **IGSID** (não tem telefone).

### 2.1 Canais — generalizar `whatsapp_config`
Reusar a tabela de canais (evita duplicar `conversations.channel_id`, `resolveChannelConfig`, inbox):
```sql
alter table public.whatsapp_config
  add column if not exists channel_type text not null default 'whatsapp'
    check (channel_type in ('whatsapp','instagram')),
  add column if not exists ig_user_id text,       -- 17841439327821349
  add column if not exists ig_page_id text;        -- 152902442083026
create unique index if not exists whatsapp_config_ig_user_unique
  on public.whatsapp_config(ig_user_id) where ig_user_id is not null;
```
`phone_number_id`/`waba_id` passam a nullable p/ canal instagram. Reusar o `access_token` (cifrado `ENCRYPTION_KEY`, `iv:ct:tag`, ver `src/lib/whatsapp/encryption.ts`) pro page token — OU, como a Edge Function já usa o secret `IG_TOKEN`, pode deixar o token fora do banco.

### 2.2 Contatos — identidade Instagram
`contacts.phone` é `NOT NULL` + dedupe por `(account_id, phone_normalized)` (migration 022):
```sql
alter table public.contacts
  alter column phone drop not null,
  add column if not exists instagram_id text,        -- IGSID
  add column if not exists instagram_username text;
create unique index if not exists contacts_account_igsid_unique
  on public.contacts(account_id, instagram_id) where instagram_id is not null;
```
Ajustar `src/lib/contacts/dedupe.ts` (`findExistingContact`) p/ dedupe por `instagram_id` no inbound do IG.

### 2.3 Conversas e mensagens
- `conversations.channel_id` **já existe** (migration 056) — reusar; conversa IG aponta pro canal `channel_type='instagram'`.
- `messages` reusa: `sender_type` ('customer'|'agent'|'bot'). Mapear anexos IG (image, share, story_reply) pros campos de mídia.
- `conversations.phone_number_id` é NOT NULL — tornar nullable (ou gravar `ig_user_id`). Ver migration original (~linha 193).

---

## 3. Ingestão — webhook de DM

**A ingestão JÁ recebe as DMs** (Edge Function `ig-comment-webhook` v4, campo `messages`, logando em `ig_dm_events`). Falta só **gravar nas tabelas do CRM**. Duas formas:

**(A) — RECOMENDADA: a própria Edge Function grava nas tabelas do CRM.** Como a Edge Function e o CRM usam o **mesmo Supabase** (`uymmbqockiqcpporluxk`), o handler de `messaging` pode escrever direto em `contacts`/`conversations`/`messages` (tem service key). Sem endpoint novo na Vercel. Ideal: extrair o handler de DM pra uma função dedicada `ig-dm-webhook` (ou manter no mesmo, roteando por `field`).

**(B) — alternativa: novo endpoint no CRM (Vercel)** `src/app/api/instagram/webhook/route.ts` espelhando `src/app/api/whatsapp/webhook/route.ts`, e apontar o webhook `messages` pra lá. Mais alinhado com o padrão do WhatsApp, mas duplica infra (HMAC, etc.).

### Formato do payload (diferente do WhatsApp)
Instagram DM vem como `entry[].messaging[]` (não `entry[].changes[].value.messages`):
```
{ "object":"instagram", "entry":[{ "id":"<IG_ID>", "messaging":[{
    "sender":{"id":"<IGSID>"}, "recipient":{"id":"<IG_ID>"},
    "timestamp":..., "message":{ "mid":"...", "text":"...", "attachments":[...], "is_echo": false }
}]}]}
```
- `recipient.id` = conta IG que recebeu → resolve canal (`ig_user_id`) + conta.
- `sender.id` = IGSID → dedupe/cria contato (`instagram_id`). Enriquecer `username`/foto via `GET /{IGSID}?fields=username,name,profile_pic` com o page token.
- **Ignorar `message.is_echo=true`** (nossas próprias mensagens enviadas voltam como echo).

### Fluxo (reusar engines) — Fase 2
Após gravar o inbound: `runAutomationsForTrigger` (`src/lib/automations/engine.ts`), `dispatchInboundToFlows` (`src/lib/flows/engine.ts`), `maybeRunAgent` (`src/lib/ai-agent/handle.ts` — 1 agente por canal, migration 057). ⚠️ Auditar o **ponto de envio** dessas engines: hoje chama o sender do WhatsApp → rotear por `channel_type` (seção 4). Matching/flow/prompt é agnóstico.

---

## 4. Envio — outbound

### 4.1 Sender (endpoint PROVADO)
Criar `src/lib/instagram/meta-api.ts` com `sendInstagramText(pageId, igsid, text, pageToken)`:
```
POST https://graph.facebook.com/v22.0/{PAGE_ID}/messages     ⚠️ PÁGINA, não IG_ID
body: { "recipient": { "id": "<IGSID>" }, "message": { "text": "..." } }
access_token = PAGE token (GET /{PAGE_ID}?fields=access_token&access_token={system-user token})
```
> **CRÍTICO (provado 16/jul):** app é Facebook-Login/Página → envio pelo **Messenger Platform `/{PAGE_ID}/messages`**. NÃO usar `/{IG_ID}/messages` → dá `(#3) capability`. Funciona em **Standard access**. Private-reply de comentário usa `recipient.comment_id` no lugar de `recipient.id`. Botão = `message.attachment` template `generic` com `web_url` (usado no comment-to-DM). Suporta anexo por URL.

### 4.2 Roteamento por canal
`src/app/api/whatsapp/send/route.ts` e as engines devem olhar `channel_type` (via `resolveChannelConfig`) e despachar pro sender certo. Sugestão: `src/lib/messaging/send.ts` recebe `(conversation)` e roteia WhatsApp vs Instagram — um ponto só.

### 4.3 Regras de janela (Meta)
- **≤24h**: texto livre pra quem mandou DM nas últimas 24h. ✅ funciona em Standard (provado).
- **>24h (Human Agent, até 7 dias)**: precisa da tag `human_agent` + a **permissão human_agent via App Review** (parado). Sem isso, fora de 24h não envia.
- **Sem templates de sessão** como o WhatsApp: fora da janela não dá pra iniciar (a não ser private-reply de comentário, que é o comment-to-DM). UI deve mostrar badge "janela expirada".

---

## 5. UI / Configurações

- **Conectar canal Instagram**: em Configurações → Canais, gravar `whatsapp_config` com `channel_type='instagram'`, `ig_user_id`, `ig_page_id`. MVP: insert manual com os IDs conhecidos.
- **Inbox** (`src/components/inbox`, `src/app/(dashboard)/inbox`): já lista por canal. Adicionar ícone/rótulo Instagram, `@username` no lugar do telefone, badge de janela (24h/expirada).
- **1 agente IA por canal** já existe (migration 057).

---

## 6. Assinar o webhook `messages` — ✅ FEITO

Já executado:
```
POST /{APP_ID}/subscriptions  object=instagram  fields=comments,messages
  callback_url=https://uymmbqockiqcpporluxk.supabase.co/functions/v1/ig-comment-webhook
  verify_token=***REMOVED-VERIFY-TOKEN***  access_token=APP_ID|APP_SECRET
```
Estado atual (confirmado): objeto `instagram` ativo com `comments, live_comments, mentions, messages`. Webhooks do objeto `instagram` são por-app; comment e DM chegam no mesmo callback e são roteados por `field`/`messaging` dentro do handler.

---

## 7. Fases

- **Fase 0 — provar viabilidade:** ✅ **FEITO** (receber+responder em Standard access; webhook messages assinado; DMs logando em `ig_dm_events`).
- **Fase 1 — inbox manual:** migrations 2.1–2.3 · gravar DM recebida em `contacts`/`conversations`/`messages` (via forma A da seção 3) · sender de texto (seção 4) · inbox mostra e responde DM dentro de 24h.
- **Fase 2 — automação + IA:** rotear automations/flows/agente pro sender IG · anexos · (human_agent 7d se/quando o App Review sair).
- **Fase 3 — convergência com comment-to-DM:** a DM nascida de comentário também vira conversa no inbox.

---

## 8. Relação com o comment-to-DM

A Edge Function **`ig-comment-webhook`** (v4) já faz os dois: comentário→resposta pública+DM (private-reply com botão→`wa.me`) E loga DMs recebidas em `ig_dm_events`. Tabelas: `ig_keyword_rules`, `ig_comment_events`, `ig_dm_events`. Memória do projeto: `ig-comment-to-dm-automation`.

| | Comment-to-DM (no ar) | Inbox de DM (a construir) |
|---|---|---|
| Gatilho | Comentário c/ palavra-chave | DM recebida |
| Webhook field | `comments` | `messages` |
| Ação | 1 private-reply → botão wa.me | Conversa contínua no CRM |
| Onde roda | Edge Function | Edge Function (grava no CRM) + UI do CRM |

**Mapa palavra IG ↔ código do CRM** (as automações do CRM usam códigos próprios, não a palavra do IG): DNA→`DNA`(AUGRA); MÁQUINA/GESTÃO→`DIAG-MAQUINA`; GARGALO→`DIAG-GARGALO`; ANÁLISE→`AUTOMATICO`; FUNIL→`MAPA-FUNIL` (todos 3R).

---

## 9. Checklist de arquivos

**Criar:**
- `supabase/migrations/0XX_instagram_channel.sql` (2.1–2.3)
- Ingestão: **forma A** — nova Edge Function `ig-dm-webhook` (ou estender `ig-comment-webhook`) que grava em `contacts`/`conversations`/`messages`; **forma B** — `src/app/api/instagram/webhook/route.ts`
- `src/lib/instagram/meta-api.ts` (envio — `POST /{PAGE_ID}/messages`)
- `src/lib/messaging/send.ts` (roteador por canal) — recomendado

**Alterar:**
- `src/lib/contacts/dedupe.ts` (dedupe por IGSID)
- `src/app/api/whatsapp/send/route.ts` + engines (`automations/engine.ts`, `flows/engine.ts`, `ai-agent/handle.ts`) → rotear envio por `channel_type`
- `src/components/inbox/*` + `src/app/(dashboard)/inbox/*` (ícone/username/janela IG)
- Configurações de canais (conectar Instagram)

**Referências de espelho:** `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/meta-api.ts`, `src/lib/whatsapp/channel.ts` (`resolveChannelConfig`), `docs/MULTICANAL-MULTIAGENTE.md`, migrations `056/057/058`. Edge Functions atuais no Supabase: `ig-comment-webhook` (comentário+DM log), `ig-reels-autopost`, `ig-autopost`, `ig-dashboard`.
