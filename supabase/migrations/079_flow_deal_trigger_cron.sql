-- pg_cron do sweeper de gatilhos deal_stage (1×/min) — padrão 070/077.
-- Segredo em app_config('flows_deal_cron_secret'). Aplicada junto do deploy
-- da rota /api/automations/deal-triggers/process (99bcc9c).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'flows-deal-triggers';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'flows-deal-triggers',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/automations/deal-triggers/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'flows_deal_cron_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;
