-- Histórico vivo por negócio: timeline unificada que se autoalimenta das ações
-- do dia a dia (criação, mudança de etapa, troca de responsável, status, valor).
-- Já aplicada em produção via MCP; versionada aqui para rastreabilidade.
create table if not exists public.deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  type text not null,               -- created | created_via_integration | stage_changed | assignee_changed | status_changed | value_changed | note_added
  actor_user_id uuid,               -- usuário que fez a ação; null = sistema/integração
  from_id uuid,
  to_id uuid,
  from_value text,
  to_value text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_deal_events_deal on public.deal_events(deal_id, created_at desc);
create index if not exists idx_deal_events_account on public.deal_events(account_id, created_at desc);

alter table public.deal_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='deal_events' and policyname='de_select_member') then
    create policy de_select_member on public.deal_events for select using (public.is_account_member(account_id));
  end if;
end $$;

-- Trigger: grava eventos a cada INSERT/UPDATE em deals. SECURITY DEFINER p/ ignorar RLS.
-- auth.uid() = quem fez (nulo em ações de service_role/automação = "sistema").
-- Tudo dentro de um bloco com EXCEPTION: o log é best-effort e NUNCA derruba a escrita do negócio.
create or replace function public.log_deal_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor uuid;
begin
  begin
    begin v_actor := auth.uid(); exception when others then v_actor := null; end;
    if tg_op = 'INSERT' then
      insert into public.deal_events(deal_id, account_id, type, actor_user_id, to_id, to_value, metadata)
      values (new.id, new.account_id, 'created', v_actor, new.stage_id,
              (select name from public.pipeline_stages where id = new.stage_id),
              jsonb_build_object('title', new.title, 'value', new.value));
    elsif tg_op = 'UPDATE' then
      if new.stage_id is distinct from old.stage_id then
        insert into public.deal_events(deal_id, account_id, type, actor_user_id, from_id, to_id, from_value, to_value)
        values (new.id, new.account_id, 'stage_changed', v_actor, old.stage_id, new.stage_id,
                (select name from public.pipeline_stages where id = old.stage_id),
                (select name from public.pipeline_stages where id = new.stage_id));
      end if;
      if new.assigned_to is distinct from old.assigned_to then
        insert into public.deal_events(deal_id, account_id, type, actor_user_id, from_id, to_id)
        values (new.id, new.account_id, 'assignee_changed', v_actor, old.assigned_to, new.assigned_to);
      end if;
      if new.status is distinct from old.status then
        insert into public.deal_events(deal_id, account_id, type, actor_user_id, from_value, to_value)
        values (new.id, new.account_id, 'status_changed', v_actor, old.status, new.status);
      end if;
      if coalesce(new.value,0) is distinct from coalesce(old.value,0) then
        insert into public.deal_events(deal_id, account_id, type, actor_user_id, from_value, to_value)
        values (new.id, new.account_id, 'value_changed', v_actor, old.value::text, new.value::text);
      end if;
    end if;
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists trg_log_deal_event on public.deals;
create trigger trg_log_deal_event
  after insert or update on public.deals
  for each row execute function public.log_deal_event();

-- Backfill 'created' p/ deals existentes (data real de criação).
insert into public.deal_events(deal_id, account_id, type, to_id, to_value, created_at, metadata)
select d.id, d.account_id, 'created', d.stage_id,
       (select name from public.pipeline_stages where id = d.stage_id),
       d.created_at, jsonb_build_object('title', d.title, 'value', d.value, 'backfill', true)
from public.deals d
where not exists (select 1 from public.deal_events e where e.deal_id = d.id and e.type = 'created');

-- Backfill mudanças de etapa conhecidas (de deal_stage_events, com 'de' via lag).
insert into public.deal_events(deal_id, account_id, type, from_id, to_id, from_value, to_value, created_at, metadata)
select x.deal_id, x.account_id, 'stage_changed', x.prev_stage, x.stage_id,
       (select name from public.pipeline_stages where id = x.prev_stage),
       (select name from public.pipeline_stages where id = x.stage_id),
       x.entered_at, jsonb_build_object('backfill', true)
from (
  select e.deal_id, e.account_id, e.stage_id, e.entered_at,
         lag(e.stage_id) over (partition by e.deal_id order by e.entered_at) as prev_stage,
         row_number() over (partition by e.deal_id order by e.entered_at) as rn
  from public.deal_stage_events e
) x
where x.rn > 1 and x.prev_stage is distinct from x.stage_id;
