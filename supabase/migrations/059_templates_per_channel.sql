-- Templates por canal (sub-fase do multi-canal).
--
-- Cada número pode ter uma WABA própria com seu próprio conjunto de templates.
-- message_templates ganha channel_id; a unicidade passa de (user_id, name,
-- language) para (channel_id, name, language). Backfill: templates existentes
-- vão pro canal primário da conta.

alter table public.message_templates
  add column if not exists channel_id uuid
  references public.whatsapp_config(id) on delete cascade;

update public.message_templates t
set channel_id = w.id
from public.whatsapp_config w
where w.account_id = t.account_id and w.is_primary and t.channel_id is null;

-- Troca o índice único (era a chave do upsert do submit).
drop index if exists public.message_templates_user_name_language_key;
create unique index if not exists message_templates_channel_name_language_key
  on public.message_templates(channel_id, name, language);

create index if not exists idx_message_templates_channel
  on public.message_templates(channel_id);

comment on column public.message_templates.channel_id is
  'Canal/WABA a que o template pertence. Cada número tem seu conjunto de templates.';
