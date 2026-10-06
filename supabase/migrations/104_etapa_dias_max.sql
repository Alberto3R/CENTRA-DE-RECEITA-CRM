-- ============================================================
-- 104_etapa_dias_max.sql — negócio parado fica vermelho
--
-- pipeline_stages.dias_max: quantos dias um negócio pode ficar na etapa
-- antes de o card ficar vermelho. Nulo = sem alerta. Funis existentes
-- ficam nulos de propósito (ligar alerta em funil com centenas de negócios
-- antigos pintaria o quadro inteiro); os modelos da biblioteca já vêm com
-- prazo por etapa.
--
-- deals.stage_entered_at: quando o negócio entrou na etapa atual. Mantido
-- por trigger — o card lê direto, sem varrer deal_stage_events.
-- ============================================================

alter table public.pipeline_stages
  add column if not exists dias_max integer check (dias_max is null or dias_max > 0);

alter table public.deals
  add column if not exists stage_entered_at timestamptz;

-- Backfill: última entrada registrada na etapa atual; sem registro, a última
-- atualização do negócio (melhor aproximação disponível).
update public.deals d
   set stage_entered_at = coalesce(
     (select max(e.entered_at) from public.deal_stage_events e
       where e.deal_id = d.id and e.stage_id = d.stage_id),
     d.updated_at, d.created_at)
 where d.stage_entered_at is null;

create or replace function public.deals_set_stage_entered_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_deals_stage_entered_at on public.deals;
create trigger trg_deals_stage_entered_at
  before insert or update of stage_id on public.deals
  for each row execute function public.deals_set_stage_entered_at();
