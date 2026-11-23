-- ============================================================
-- 125_agenda_reservas_cron.sql — agendador da leitura de reservas
--
-- ⚠️ APLICAR SÓ DEPOIS DO DEPLOY.
-- O pg_cron chama a URL de PRODUÇÃO. Antes de
-- /api/google/booking-sync/process existir lá, cada chamada é um 404
-- (mesmo cuidado da 070 e da 087).
--
-- A cada 5 minutos: lê os eventos alterados da agenda conectada de cada
-- conta com calendar_booking_sync.enabled, registra a reserva, confirma no
-- WhatsApp e agenda os lembretes. Desligar:
--   select cron.unschedule('google-booking-sync');
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'google-booking-sync';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'google-booking-sync',
    '*/5 * * * *',
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/google/booking-sync/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'booking_sync_cron_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;
