-- pg_cron diário do agente 3R de acompanhamento (fase 4b) — padrão da migration 055.
-- ============================================================
-- ⚠️ APLICAR SÓ NO DEPLOY da branch: o cron chama a URL de PRODUÇÃO
-- /api/ccc/acompanhamento/process, que só existe depois do deploy. Aplicar
-- antes = cron batendo em 404 todo dia (inofensivo, mas inútil).
--
-- O endpoint varre as contas ATIVAS (ccc_acompanhamento_config.ativo=true) e
-- envia o resumo pro gestor. Contas nascem inativas → nada é enviado sem opt-in.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'ccc-acompanhamento-diario';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'ccc-acompanhamento-diario',
    '0 12 * * *',   -- 12:00 UTC ~ 09:00 BRT (resumo matinal)
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/ccc/acompanhamento/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'ccc_cron_secret')
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
end $$;
