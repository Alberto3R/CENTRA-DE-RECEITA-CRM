-- Log de disparo de toques da cadência — idempotência (cada toque, por negócio
-- e etapa, sai uma vez só). Aditiva.

create table if not exists public.ccc_cadencia_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  stage_id uuid,
  dia_toque int not null,
  vendedor_id uuid,
  enviado_em timestamptz not null default now(),
  unique (deal_id, stage_id, dia_toque)
);
create index if not exists idx_ccc_cadencia_log_account on public.ccc_cadencia_log(account_id, enviado_em desc);

alter table public.ccc_cadencia_log enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='ccc_cadencia_log' and policyname='ccl_select_member'
  ) then
    create policy ccl_select_member on public.ccc_cadencia_log
      for select using (public.is_account_member(account_id));
  end if;
end $$;
