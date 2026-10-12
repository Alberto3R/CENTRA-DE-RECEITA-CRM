-- 113 · Gasto de mídia por dia e por anúncio (F2 do relatório de aquisição).
--
-- Puxado da Marketing API (insights, level=ad, time_increment=1) para cada
-- linha ativa de ad_accounts (mig 112). Escrita só pelo service role (rota
-- /api/acquisition/spend-sync); membros da conta só leem.
--
-- Uma linha por (conta de anúncio, dia, anúncio). A sincronização reprocessa
-- os últimos dias porque a Meta ajusta números retroativamente.

create table if not exists public.ad_spend_daily (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  date date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text not null,
  ad_name text,
  spend numeric(14,2) not null default 0,
  currency text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  -- Leads segundo a Meta (pixel/formulário/mensagem). Serve para o alerta
  -- "Meta diz X, CRM recebeu Y"; NÃO é a contagem oficial do relatório.
  meta_leads integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (ad_account_id, date, ad_id)
);

create index if not exists ad_spend_daily_account_date_idx
  on public.ad_spend_daily (account_id, date);
create index if not exists ad_spend_daily_campaign_idx
  on public.ad_spend_daily (account_id, campaign_id);

alter table public.ad_spend_daily enable row level security;

create policy "membros veem o gasto de mídia"
  on public.ad_spend_daily for select
  using (public.is_account_member(account_id));

-- Agenda: a cada 6 h. Mesmo padrão/segredo das rotas do Lead Ads (077/080).
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'acquisition-spend-sync';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'acquisition-spend-sync',
    '20 */6 * * *',
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/acquisition/spend-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'leadgen_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );
end $$;
