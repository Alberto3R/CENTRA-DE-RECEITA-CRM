-- Rastreamento de entrada em etapa — o "marco zero" da cadência (e passa a
-- medir tempo-em-etapa pros indicadores). Registra cada vez que um negócio
-- entra numa etapa. Base do motor de cadência da CCC. Aditiva.

create table if not exists public.deal_stage_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  account_id uuid references public.accounts(id) on delete cascade,
  entered_at timestamptz not null default now()
);
create index if not exists idx_deal_stage_events_deal on public.deal_stage_events(deal_id, entered_at desc);
create index if not exists idx_deal_stage_events_account on public.deal_stage_events(account_id);

-- RLS: membros da conta leem; escrita via trigger (security definer) / service role.
alter table public.deal_stage_events enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='deal_stage_events' and policyname='dse_select_member'
  ) then
    create policy dse_select_member on public.deal_stage_events
      for select using (public.is_account_member(account_id));
  end if;
end $$;

-- trigger: registra a etapa inicial (INSERT) e cada mudança de etapa (UPDATE).
create or replace function public.registrar_deal_stage_event()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    if new.stage_id is not null then
      insert into public.deal_stage_events(deal_id, stage_id, account_id, entered_at)
      values (new.id, new.stage_id, new.account_id, coalesce(new.created_at, now()));
    end if;
  elsif (tg_op = 'UPDATE') then
    if new.stage_id is distinct from old.stage_id and new.stage_id is not null then
      insert into public.deal_stage_events(deal_id, stage_id, account_id, entered_at)
      values (new.id, new.stage_id, new.account_id, now());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_deal_stage_event on public.deals;
create trigger trg_deal_stage_event
  after insert or update of stage_id on public.deals
  for each row execute function public.registrar_deal_stage_event();

-- backfill: pros deals que já existem, cria um evento com a etapa atual
-- (entered_at = updated_at, melhor proxy que temos pro legado sem histórico).
insert into public.deal_stage_events(deal_id, stage_id, account_id, entered_at)
select d.id, d.stage_id, d.account_id, coalesce(d.updated_at, d.created_at, now())
from public.deals d
where d.stage_id is not null
  and not exists (select 1 from public.deal_stage_events e where e.deal_id = d.id);
