-- 112 · Relatório de Aquisição — a régua POR CONTA.
--
-- Cada negócio mede aquisição do seu jeito: canais diferentes, contas de
-- anúncio diferentes, margem diferente. Nada disso é global no CRM; mora aqui,
-- por account_id.
--
-- Receita, nesta fase, é SÓ o que o time registra no CRM: negócio com
-- status='won' e o valor informado (deals.value). Venda de gateway/checkout
-- não entra. Por isso a trava "ganho exige valor" é opcional por conta.

-- ------------------------------------------------------------------
-- 1. Régua da conta (1 linha por conta)
-- ------------------------------------------------------------------
create table if not exists public.acquisition_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  -- Quem leva o crédito da venda: o primeiro ou o último toque do contato.
  attribution_model text not null default 'first_touch'
    check (attribution_model in ('first_touch', 'last_touch')),
  -- Toque mais velho que isso (antes do ganho) não leva crédito.
  attribution_window_days integer not null default 90
    check (attribution_window_days between 1 and 730),
  -- Bloqueia "Marcar como ganho" com valor vazio/zero.
  require_value_on_won boolean not null default false,
  -- Funis que NÃO entram no relatório (ex.: recuperação, testes).
  excluded_pipeline_ids uuid[] not null default '{}',
  -- Para ir de receita a resultado (F4). Nulo = não informado.
  margin_pct numeric(5,2) check (margin_pct is null or margin_pct between 0 and 100),
  commission_pct numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  updated_at timestamptz not null default now()
);

alter table public.acquisition_settings enable row level security;

create policy "membros veem a régua de aquisição"
  on public.acquisition_settings for select
  using (public.is_account_member(account_id));

create policy "admins criam a régua de aquisição"
  on public.acquisition_settings for insert
  with check (public.is_account_member(account_id, 'admin'::account_role_enum));

create policy "admins editam a régua de aquisição"
  on public.acquisition_settings for update
  using (public.is_account_member(account_id, 'admin'::account_role_enum))
  with check (public.is_account_member(account_id, 'admin'::account_role_enum));

-- ------------------------------------------------------------------
-- 2. Canais da conta + regras de classificação
-- ------------------------------------------------------------------
-- Um lead/venda cai no PRIMEIRO canal (por position) cuja regra bate.
-- Nenhum bateu → "Não identificado" (não é linha; é o resto, e aparece
-- no relatório com o percentual).
--   match_sources      → lead_attribution.source        (igual, sem caixa)
--   match_utm_sources  → lead_attribution.utm_source    (igual, sem caixa)
--   match_utm_mediums  → lead_attribution.utm_medium    (igual, sem caixa)
--   match_pipeline_ids → deals.pipeline_id  (canais sem rastro digital:
--                        prospecção ativa, eventos, indicação)
create table if not exists public.acquisition_channels (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'other'
    check (kind in ('paid', 'organic', 'outbound', 'referral', 'event', 'other')),
  color text,
  position integer not null default 0,
  match_sources text[] not null default '{}',
  match_utm_sources text[] not null default '{}',
  match_utm_mediums text[] not null default '{}',
  match_pipeline_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists acquisition_channels_account_idx
  on public.acquisition_channels (account_id, position);

alter table public.acquisition_channels enable row level security;

create policy "membros veem os canais de aquisição"
  on public.acquisition_channels for select
  using (public.is_account_member(account_id));

create policy "admins criam canais de aquisição"
  on public.acquisition_channels for insert
  with check (public.is_account_member(account_id, 'admin'::account_role_enum));

create policy "admins editam canais de aquisição"
  on public.acquisition_channels for update
  using (public.is_account_member(account_id, 'admin'::account_role_enum))
  with check (public.is_account_member(account_id, 'admin'::account_role_enum));

create policy "admins removem canais de aquisição"
  on public.acquisition_channels for delete
  using (public.is_account_member(account_id, 'admin'::account_role_enum));

-- ------------------------------------------------------------------
-- 3. Contas de anúncio da conta (o gasto é puxado delas na F2)
-- ------------------------------------------------------------------
create table if not exists public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null default 'meta' check (provider in ('meta')),
  -- ID numérico da conta de anúncio, sem o prefixo act_.
  external_id text not null check (external_id ~ '^[0-9]{5,25}$'),
  name text,
  currency text,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  unique (account_id, provider, external_id)
);

alter table public.ad_accounts enable row level security;

create policy "membros veem as contas de anúncio"
  on public.ad_accounts for select
  using (public.is_account_member(account_id));

create policy "admins vinculam contas de anúncio"
  on public.ad_accounts for insert
  with check (public.is_account_member(account_id, 'admin'::account_role_enum));

create policy "admins editam contas de anúncio"
  on public.ad_accounts for update
  using (public.is_account_member(account_id, 'admin'::account_role_enum))
  with check (public.is_account_member(account_id, 'admin'::account_role_enum));

create policy "admins desvinculam contas de anúncio"
  on public.ad_accounts for delete
  using (public.is_account_member(account_id, 'admin'::account_role_enum));

-- ------------------------------------------------------------------
-- 4. Trava "ganho exige valor" (só para quem ligou na régua)
-- ------------------------------------------------------------------
create or replace function public.deals_ganho_exige_valor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'won'
     and (tg_op = 'INSERT' or old.status is distinct from 'won')
     and coalesce(new.value, 0) <= 0
     and exists (
       select 1 from acquisition_settings s
       where s.account_id = new.account_id and s.require_value_on_won
     )
  then
    raise exception 'ganho_sem_valor'
      using hint = 'Informe o valor da venda antes de marcar o negócio como ganho.';
  end if;
  return new;
end;
$$;

drop trigger if exists deals_ganho_exige_valor on public.deals;
create trigger deals_ganho_exige_valor
  before insert or update of status, value on public.deals
  for each row execute function public.deals_ganho_exige_valor();
