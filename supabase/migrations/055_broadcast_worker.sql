-- Worker de disparo (background) + agendador.
--
-- Objetivo: resolver as limitações do disparo client-side:
--   (a) retomar disparos abandonados quando a aba fecha no meio;
--   (b) enviar disparos AGENDADOS quando vencem;
--   (c) enviar rascunhos re-enfileirados.
--
-- Desenho: o app enfileira (broadcasts + broadcast_recipients pending). Um
-- endpoint /api/whatsapp/broadcast/process dreno server-side é chamado a cada
-- minuto pelo pg_cron (self-contained no Supabase — não depende de env na
-- Vercel). O segredo do cron mora no banco (app_config) e é lido tanto pelo
-- cron (no header) quanto pelo endpoint (via service role) — sem env nova.
--
-- Segurança anti-duplo-envio: claim atômico (FOR UPDATE SKIP LOCKED) de
-- destinatários pending; o "Enviar agora" client-side mantém o broadcast
-- "fresco" (updated_at), então o cron só assume um 'sending' que ficou
-- ocioso (aba fechada).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Marca de quando um destinatário foi reservado para envio (claim). Permite
-- recuperar reservas presas (worker morreu antes de concluir).
alter table public.broadcast_recipients
  add column if not exists claimed_at timestamptz;

-- Segredo do cron (compartilhado banco↔endpoint), gerado uma vez.
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
insert into public.app_config (key, value)
values ('broadcast_cron_secret', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Reserva atômica de até p_limit destinatários pendentes de um broadcast.
-- Também recupera reservas presas (claimed há > 3 min ainda 'pending').
-- Retorna as linhas reservadas (com o contato) para o worker enviar.
create or replace function public.claim_broadcast_recipients(
  p_broadcast uuid,
  p_limit int
) returns table (recipient_id uuid, contact_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update broadcast_recipients r
  set claimed_at = now()
  where r.id in (
    select id from broadcast_recipients
    where broadcast_id = p_broadcast
      and status = 'pending'
      and (claimed_at is null or claimed_at < now() - interval '3 minutes')
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning r.id, r.contact_id;
end;
$$;

-- Agendador: a cada minuto, chama o endpoint de dreno. Fire-and-forget.
-- Reagenda de forma idempotente (remove um job homônimo antes de recriar).
do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'broadcast-drain';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'broadcast-drain',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/whatsapp/broadcast/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'broadcast_cron_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;
