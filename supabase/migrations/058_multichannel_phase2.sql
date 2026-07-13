-- Multi-canal — Fase 2: disparo e ligação sabem de qual CANAL saem.
--
-- broadcasts.channel_id → o disparo sai por aquele número.
-- whatsapp_calls.channel_id → a ligação acontece naquele número.
-- Backfill: entidades existentes apontam pro canal primário da conta.

alter table public.broadcasts
  add column if not exists channel_id uuid
  references public.whatsapp_config(id) on delete set null;

alter table public.whatsapp_calls
  add column if not exists channel_id uuid
  references public.whatsapp_config(id) on delete set null;

update public.broadcasts b
set channel_id = w.id
from public.whatsapp_config w
where w.account_id = b.account_id and w.is_primary and b.channel_id is null;

update public.whatsapp_calls c
set channel_id = w.id
from public.whatsapp_config w
where w.account_id = c.account_id and w.is_primary and c.channel_id is null;

comment on column public.broadcasts.channel_id is
  'Canal (whatsapp_config) de onde o disparo é enviado. Null = primário.';
comment on column public.whatsapp_calls.channel_id is
  'Canal (whatsapp_config) em que a ligação acontece. Null = primário.';
