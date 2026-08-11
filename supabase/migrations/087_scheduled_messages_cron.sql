-- ============================================================
-- 087_scheduled_messages_cron.sql — agendador do worker
--
-- ⚠️ APLICAR SÓ DEPOIS DO DEPLOY.
-- O pg_cron chama a URL de PRODUÇÃO. Aplicar esta migration antes de
-- /api/whatsapp/scheduled/process existir em produção = pg_cron batendo
-- em 404 a cada minuto (mesmo cuidado documentado na 070).
--
-- Separada da 086 exatamente por isso: a tabela e a RPC podem ir a
-- qualquer momento; o cron, não.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'scheduled-messages-drain';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'scheduled-messages-drain',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/whatsapp/scheduled/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'scheduled_messages_cron_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;
