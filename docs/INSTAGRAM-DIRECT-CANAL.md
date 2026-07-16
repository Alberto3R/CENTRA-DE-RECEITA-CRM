# Instagram Direct como canal no CRM

Plano para receber e responder **DMs do Instagram** dentro do CRM (Central de Receita), como mais um canal ao lado do WhatsApp. Espelha a arquitetura multi-canal existente (`whatsapp_config` = tabela de canais, `conversations.channel_id`, engines de automação/IA).

> **Escopo:** o **inbox de DM** (mensagens diretas). Não confundir com o **comment-to-DM** (comentário → resposta automática), que já roda na Edge Function `ig-comment-webhook`. Compartilham o mesmo App/token/webhook. Ver seção 8.

---

## ✅ STATUS — Fases 1 e 2 ENTREGUES E NO AR (16/jul/2026)

**Inbox de DM do Instagram completo em produção** (`sales-3r-crm.vercel.app`), testado ao vivo com a conversa real da @augra.rt. Viabilidade + build + deploy feitos. As seções 1–9 abaixo são o registro do plano original (referência técnica ainda válida); esta seção documenta o que efetivamente shipou.

### Fase 1 — inbox manual ✅ (no ar)
| Capacidade | Estado |
|---|---|
| Receber DM → vira conversa no inbox (contato `@username` + foto, selo IG) | ✅ no ar |
| Responder DM em texto dentro da janela de 24h | ✅ no ar |
| Responder depois de 24h (human_agent) | ⚠️ precisa App Review (parado) — Fase 2b |

- **Migration `066_instagram_channel.sql`**: `whatsapp_config` ganhou `channel_type` ('whatsapp'|'instagram') / `ig_user_id` / `ig_page_id` (phone_number_id → nullable); `contacts` ganhou `instagram_id` / `instagram_username` (phone → nullable), dedupe por IGSID no índice parcial `contacts_account_igsid_unique` (espelha `wa_user_id`).
- **Canal IG semeado** na conta Sales 3R (`fd9b374f…`), NÃO-primário. Token de system user 3R cifrado no `access_token` (mesmo AES-256-GCM do WhatsApp).
- **Ingestão = Forma A**: a Edge Function `ig-comment-webhook` (**v6**) grava a DM em `contacts`/`conversations`/`messages` (resolve canal por `recipient.id`, enriquece `@username`+foto via Graph, idempotente por `mid`). Mantém comment-to-DM + `ig_dm_events`. Escolhida porque o webhook do objeto `instagram` é por-app com **callback único** — não dá pra mandar só `messages` pro Vercel sem quebrar o comment-to-DM.
- **Envio**: `src/lib/instagram/meta-api.ts` (page token + `POST /{ig_page_id}/messages`) + `src/lib/instagram/send.ts` (janela 24h). `/api/whatsapp/send` roteia por `contact.instagram_id`.
- **Inbox UI**: `src/components/inbox/channel-display.tsx` (glifo IG inline — o lucide-react vendado **não** exporta `Instagram` — + `@username` no lugar do telefone; esconde ligação/mídia/modelos WhatsApp-only). Badge de 24h já era agnóstico.
- **Configurações → Instagram**: seção própria (`src/components/settings/instagram-settings.tsx`, ícone `AtSign`), read-only. O painel de WhatsApp passou a listar só `channel_type='whatsapp'`.

### Fase 2 — automação + IA ✅ (core no ar)
- **`src/lib/messaging/send.ts`**: sender de texto agnóstico de canal (+ testes). Automations (`automations/meta-send.ts`), flows (`flows/meta-send.ts` `engineSendText`) e agente de IA (`ai-agent/handle.ts`) roteiam o envio por `channel_type` — caminho WhatsApp intacto. Bônus: resolvem o canal por `conversation.channel_id` (corrige multi-canal WhatsApp), com fallback pro primário.
- **`/api/instagram/process`**: roda flows → automations → agente para a DM recebida (auth por `ig_app_config.ingest_secret`, header `x-ig-secret`). A Edge Function v6 chama esse endpoint após gravar a DM (Forma A → engines vivem no Next).
- Flows de **mídia/botões/lista** no IG ainda não têm equivalente (falham com segurança em contato sem telefone) → Fase 2b.

### Ajustes pós-teste real (commits `27ee0c3` / `edcd056`)
- **Crash ao abrir a DM**: contato IG (sem nome/telefone) quebrava `(name||phone).charAt(0)` no contact-sidebar → passou a usar os helpers de canal.
- **Banner/cards "WhatsApp não conectado" à toa**: o 2º canal (IG) fazia `whatsapp_config.eq(account_id).maybeSingle()` dar erro de múltiplas linhas → filtrar `channel_type='whatsapp'` (inbox, Configurações → Visão geral, "Verificar com a Meta").

### Infra / deploy
- Supabase (mesmo projeto do CRM `uymmbqockiqcpporluxk`): webhook `instagram` assinado (`comments,messages`), Edge Function `ig-comment-webhook` **v6**, `ig_app_config` com `crm_url` + `ingest_secret`.
- Deploy: repo **Alberto3R/wacrm** (main → prod na Vercel, projeto `prj_qZ8Zn…`). Fases 1+2 em `93d40ca` + fixes.

### Pendente
- **Agente de IA do canal IG**: o canal ainda NÃO tem `ai_agent_config` → só automations/flows respondem no IG até criar um (clonar a persona do WhatsApp num passo).
- **Fase 2b**: anexos/mídia (in/out), human_agent >24h (App Review parado), botões/lista no IG.
- **Fase 3**: DM nascida de comentário vira conversa no inbox.

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
- **Fase 1 — inbox manual:** ✅ **FEITO E NO AR** — migration 066 · DM gravada em `contacts`/`conversations`/`messages` (forma A) · sender de texto · inbox mostra e responde DM ≤24h. Ver a seção de STATUS no topo.
- **Fase 2 — automação + IA:** ✅ **FEITO E NO AR (core)** — automations/flows/agente roteados pro sender IG via `src/lib/messaging/send.ts` + `/api/instagram/process`. **Pendente (2b):** anexos/mídia, botões/lista no IG, human_agent >24h (App Review parado). ⚠️ o canal IG ainda precisa de um `ai_agent_config` próprio pra IA responder.
- **Fase 3 — convergência com comment-to-DM:** ⏳ pendente — a DM nascida de comentário também vira conversa no inbox.

---

## 8. Relação com o comment-to-DM

A Edge Function **`ig-comment-webhook`** (v6) já faz os dois: comentário→resposta pública+DM (private-reply com botão→`wa.me`) E, agora, grava a DM recebida no CRM (Fase 1) além de logar em `ig_dm_events`. Tabelas: `ig_keyword_rules`, `ig_comment_events`, `ig_dm_events`. Memória do projeto: `ig-comment-to-dm-automation`.

| | Comment-to-DM (no ar) | Inbox de DM (no ar) |
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
