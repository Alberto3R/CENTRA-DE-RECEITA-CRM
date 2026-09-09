-- E-mail como canal — Fase 1 (modelo de dados).
--
-- Generaliza `whatsapp_config` (a tabela de CANAIS desde a migration 056) para
-- aceitar o tipo 'email' ao lado de 'whatsapp' e 'instagram', seguindo o mesmo
-- precedente que a 066 abriu para o Instagram Direct.
--
-- Provedor: ZOHO no subdomínio `time.sales3r.com.br` (decisão do Alberto,
-- 27/ago/2026). Transporte = IMAP (recebimento, por polling via pg_cron) +
-- SMTP (envio). NÃO usa OAuth — a credencial é uma SENHA DE APP do Zoho,
-- guardada CIFRADA em `access_token`, o mesmo campo e o mesmo esquema
-- AES-256-GCM que já protege os tokens de WhatsApp e Instagram.
--
-- Idempotente. Só AFROUXA restrições e ADICIONA colunas/índices que valem
-- apenas para o canal novo — nenhuma linha existente é tocada.

-- ============================================================
-- 1. Canais — aceitar o tipo 'email'
-- ============================================================
alter table public.whatsapp_config
  add column if not exists email_address     text,   -- acramos@time.sales3r.com.br
  add column if not exists email_provider    text,   -- 'zoho' | 'google' | 'other'
  add column if not exists imap_host         text,
  add column if not exists imap_port         integer,
  add column if not exists smtp_host         text,
  add column if not exists smtp_port         integer,
  add column if not exists daily_send_limit  integer,      -- teto por dia (50 no MVP)
  add column if not exists imap_last_uid     bigint,       -- ponteiro do polling incremental
  add column if not exists last_poll_at      timestamptz;  -- observabilidade do cron

-- O CHECK de channel_type é recriado (não existe ALTER CONSTRAINT para CHECK).
-- Drop + add dentro de bloco para ser re-runnable.
do $$
begin
  alter table public.whatsapp_config
    drop constraint if exists whatsapp_config_channel_type_check;
  alter table public.whatsapp_config
    add constraint whatsapp_config_channel_type_check
    check (channel_type in ('whatsapp', 'instagram', 'email'));
end $$;

-- Canal de e-mail exige uma caixa. Os outros tipos seguem intocados.
do $$
begin
  alter table public.whatsapp_config
    add constraint whatsapp_config_email_requires_address
    check (channel_type <> 'email' or email_address is not null);
exception
  when duplicate_object then null;
end $$;

-- Uma caixa por linha (identidade única do canal), espelhando
-- `whatsapp_config_ig_user_unique` e o UNIQUE(phone_number_id).
create unique index if not exists whatsapp_config_email_unique
  on public.whatsapp_config (lower(email_address))
  where email_address is not null;

comment on column public.whatsapp_config.email_address is
  'Caixa do canal de e-mail (remetente e destino das respostas).';
comment on column public.whatsapp_config.daily_send_limit is
  'Teto de envios por dia da caixa. Protege a reputação do domínio — '
  'volume acima da capacidade não dá erro, degrada em silêncio.';
comment on column public.whatsapp_config.imap_last_uid is
  'Último UID IMAP processado. O polling busca a partir daqui em vez de '
  'reprocessar a caixa inteira.';

-- ============================================================
-- 2. Contatos — achar por e-mail
-- ============================================================
-- ⚠️ Índice NÃO-único de propósito: a base já tem 111 e-mails repetidos
-- dentro da mesma conta (ranierisantos@gmail.com aparece 10x). Um UNIQUE
-- quebraria a migration. A escolha de qual contato receber a resposta fica
-- no código (preferir o que já tem conversa aberta, senão o mais recente).
create index if not exists contacts_account_email_idx
  on public.contacts (account_id, lower(email))
  where email is not null and email <> '';

-- ============================================================
-- 3. Mensagens — assunto e threading
-- ============================================================
-- `message_id` já existe e guarda o wamid do WhatsApp; passa a guardar
-- também o Message-ID RFC 5322 do e-mail. `reply_to_message_id` já existe
-- e serve de ponteiro do In-Reply-To. Falta só o assunto.
alter table public.messages
  add column if not exists subject text;

comment on column public.messages.subject is
  'Assunto do e-mail. NULL nos canais de mensageria (WhatsApp/Instagram).';

-- Casar a resposta que chega com a conversa certa, pelo Message-ID.
create index if not exists messages_message_id_idx
  on public.messages (message_id)
  where message_id is not null;
