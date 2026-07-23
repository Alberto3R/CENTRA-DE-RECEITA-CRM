-- pg_cron do backfill de Lead Ads (rede de segurança, 10 em 10 min).
-- Recupera leads que o webhook perdeu (entrega falha / Leads Access).
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'meta-leadgen-backfill';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'meta-leadgen-backfill',
    '*/10 * * * *',
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/meta/leadgen/backfill',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'leadgen_cron_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;
