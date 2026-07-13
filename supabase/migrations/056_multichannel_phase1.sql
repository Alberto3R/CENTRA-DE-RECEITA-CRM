-- Multi-canal WhatsApp — Fase 1 (núcleo).
--
-- Hoje `whatsapp_config` é 1-por-conta (UNIQUE(account_id)). Passa a ser a
-- tabela de CANAIS: a conta pode ter vários números, cada um uma linha. A
-- conversa passa a saber em QUAL canal aconteceu (channel_id). Retrocompatível:
-- com 1 canal por conta, tudo continua igual (o canal existente vira o primário
-- e todas as conversas apontam pra ele).

-- Identidade do canal.
alter table public.whatsapp_config
  add column if not exists label text,
  add column if not exists is_primary boolean not null default false;

-- Linhas existentes (1 por conta): viram o canal primário, rótulo "Principal".
update public.whatsapp_config set is_primary = true
  where is_primary = false
    and not exists (
      select 1 from public.whatsapp_config w2
      where w2.account_id = public.whatsapp_config.account_id and w2.is_primary
    );
update public.whatsapp_config set label = 'Principal' where label is null;

-- Solta o "1 número por conta". Mantém UNIQUE(phone_number_id) (13) intacto.
alter table public.whatsapp_config
  drop constraint if exists whatsapp_config_account_id_key;

-- No máximo 1 canal primário por conta.
create unique index if not exists whatsapp_config_one_primary_per_account
  on public.whatsapp_config (account_id) where is_primary;

-- Canal da conversa (em qual número ela aconteceu).
alter table public.conversations
  add column if not exists channel_id uuid
  references public.whatsapp_config(id) on delete set null;

-- Backfill: conversas apontam pro canal primário (único) da conta.
update public.conversations c
set channel_id = w.id
from public.whatsapp_config w
where w.account_id = c.account_id and w.is_primary and c.channel_id is null;

create index if not exists idx_conversations_channel
  on public.conversations(channel_id);

comment on column public.whatsapp_config.is_primary is
  'Canal primário da conta (fallback de envio quando a conversa não tem channel_id).';
comment on column public.conversations.channel_id is
  'Canal (whatsapp_config) em que a conversa acontece. Null = usar o primário.';
