-- Multi-agente de IA — Fase 3.
--
-- `ai_agent_config` era 1-por-conta (account_id PRIMARY KEY). Passa a ser
-- 1-por-CANAL: cada número do WhatsApp tem sua própria persona (ex.: SDR no
-- canal 1, Onboarding no canal 2). Retrocompatível: o agente existente é
-- amarrado ao canal primário da conta.

alter table public.ai_agent_config
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists channel_id uuid
    references public.whatsapp_config(id) on delete cascade,
  add column if not exists name text;

-- Amarra o agente atual ao canal primário da conta; dá um nome.
update public.ai_agent_config a
set channel_id = w.id
from public.whatsapp_config w
where w.account_id = a.account_id and w.is_primary and a.channel_id is null;
update public.ai_agent_config set name = 'Agente' where name is null;

-- Troca a PK de account_id para o id de superfície.
alter table public.ai_agent_config drop constraint if exists ai_agent_config_pkey;
alter table public.ai_agent_config add primary key (id);

-- No máximo 1 agente por canal. Não-parcial (serve de alvo p/ upsert onConflict);
-- múltiplos channel_id NULL continuam permitidos (nulls são distintos no PG).
create unique index if not exists ai_agent_config_channel_key
  on public.ai_agent_config(channel_id);

comment on column public.ai_agent_config.channel_id is
  'Canal (whatsapp_config) que este agente atende. 1 agente por canal.';
comment on column public.ai_agent_config.name is
  'Nome do agente (ex.: SDR, Onboarding).';
