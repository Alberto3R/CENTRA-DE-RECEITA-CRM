-- ============================================================
-- 108_deal_etapa_do_proprio_funil.sql — negócio nunca fica invisível
--
-- Entre 12/ago e 21/set/2026 a lateral do contato no Inbox oferecia as
-- etapas do PRIMEIRO funil da conta para qualquer negócio (corrigido no
-- commit 030ddf1). Quem mudava a etapa por ali deixava o negócio com
-- stage_id de um funil e pipeline_id de outro — e ele sumia de todos os
-- quadros, sem erro. Foram 75 negócios; os 72 que seguiam assim foram
-- realinhados em 06/out (backup em _bkp_funil_limpeza_20261006).
--
-- A trava: se a etapa gravada é de outro funil, o negócio passa a ser
-- desse funil. A etapa é a escolha mais recente e mais específica de quem
-- mexeu; e o negócio continua aparecendo num quadro. Melhor que rejeitar,
-- que derrubaria a captação de lead de webhook/formulário.
-- ============================================================

create or replace function public.deals_etapa_do_proprio_funil()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_pipe uuid;
begin
  if new.stage_id is null then
    return new;
  end if;
  select pipeline_id into v_pipe from pipeline_stages where id = new.stage_id;
  if v_pipe is not null and v_pipe is distinct from new.pipeline_id then
    new.pipeline_id := v_pipe;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_deals_etapa_do_proprio_funil on public.deals;
create trigger trg_deals_etapa_do_proprio_funil
  before insert or update of stage_id, pipeline_id on public.deals
  for each row execute function public.deals_etapa_do_proprio_funil();
