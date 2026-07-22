-- Novo gatilho de automação: "negócio entra em etapa" (deal_stage).
-- Reutilizável por qualquer conta: o flow dispara quando um deal entra numa
-- etapa configurada, abre a conversa com um TEMPLATE aprovado (mensagem ativa
-- fora da janela de 24h exige HSM) e então (a) encerra e deixa o agente IA
-- assumir as respostas (mode=template_only) ou (b) continua no flow (mode=flow).
-- Aditiva.

-- 1) permite o novo trigger_type
alter table public.flows drop constraint if exists flows_trigger_type_check;
alter table public.flows add constraint flows_trigger_type_check
  check (trigger_type in ('keyword','first_inbound_message','manual','deal_stage'));

-- 2) dedup/auditoria do disparo: cada deal_stage_event vira no máximo 1 disparo
--    por flow (o sweeper de cron e a chamada inline compartilham este log).
create table if not exists public.flow_deal_trigger_log (
  id uuid primary key default gen_random_uuid(),
  stage_event_id uuid not null references public.deal_stage_events(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  deal_id uuid,
  outcome text not null,   -- template_sent | run_started | skipped_* | error:*
  created_at timestamptz not null default now(),
  unique (stage_event_id, flow_id)
);
create index if not exists idx_fdtl_account on public.flow_deal_trigger_log(account_id);

alter table public.flow_deal_trigger_log enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='flow_deal_trigger_log' and policyname='fdtl_select_member'
  ) then
    create policy fdtl_select_member on public.flow_deal_trigger_log
      for select using (public.is_account_member(account_id));
  end if;
end $$;
