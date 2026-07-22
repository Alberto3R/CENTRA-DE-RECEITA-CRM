-- Lead Ads nativo (formulário instantâneo) → CRM + devolução de conversões.
-- 1) meta_leadgen_leads: vincula cada lead do formulário da Meta (leadgen_id)
--    ao contato/deal criado no CRM — o leadgen_id é a chave de match quando
--    devolvemos os eventos de estágio pro dataset (Conversion Leads).
-- 2) meta_conversion_log: idempotência do worker — cada deal_stage_event só
--    vira evento CAPI uma vez. Aditiva.

create table if not exists public.meta_leadgen_leads (
  id uuid primary key default gen_random_uuid(),
  leadgen_id text not null unique,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  page_id text,
  form_id text,
  ad_id text,
  campaign_id text,
  fit text,            -- verde | amarelo | vermelho (gate do formulário)
  answers jsonb,       -- respostas das perguntas custom
  raw jsonb,           -- field_data bruto da Meta
  created_at timestamptz not null default now()
);
create index if not exists idx_meta_leadgen_deal on public.meta_leadgen_leads(deal_id);
create index if not exists idx_meta_leadgen_account on public.meta_leadgen_leads(account_id);

alter table public.meta_leadgen_leads enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='meta_leadgen_leads' and policyname='mll_select_member'
  ) then
    create policy mll_select_member on public.meta_leadgen_leads
      for select using (public.is_account_member(account_id));
  end if;
end $$;

create table if not exists public.meta_conversion_log (
  id uuid primary key default gen_random_uuid(),
  stage_event_id uuid not null unique references public.deal_stage_events(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  deal_id uuid,
  event_name text not null,
  dataset_id text not null,
  ok boolean not null default false,
  reason text,
  sent_at timestamptz not null default now()
);
create index if not exists idx_meta_conversion_log_account on public.meta_conversion_log(account_id);

alter table public.meta_conversion_log enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='meta_conversion_log' and policyname='mcl_select_member'
  ) then
    create policy mcl_select_member on public.meta_conversion_log
      for select using (public.is_account_member(account_id));
  end if;
end $$;
