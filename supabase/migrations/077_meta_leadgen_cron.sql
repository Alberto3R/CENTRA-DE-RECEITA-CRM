-- pg_cron do worker de devolução de conversões (Lead Ads → dataset ICP-3R-CCC).
-- Padrão da migration 070 (ccc-acompanhamento): net.http_post na URL de
-- produção com o segredo lido do app_config. Aplicada APÓS o deploy da rota.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'meta-leadgen-conversions';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'meta-leadgen-conversions',
    '*/10 * * * *',   -- a cada 10 min
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/meta/leadgen/conversions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'leadgen_cron_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;
