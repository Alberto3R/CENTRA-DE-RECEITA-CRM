-- ============================================================
-- Saneamento dos leads de formulário de UMA conta (acompanha o conserto do
-- POST /api/leads/[token]: 55 no telefone + negócio reaproveitado no reenvio).
--
-- 1. Telefone sem 55: contato com 10–11 dígitos ganha o 55 do Brasil, se não
--    existir outro contato da conta com o número canônico (esses "gêmeos"
--    ficam de fora — fundir é manual, cada um tem conversa/negócio próprios).
-- 2. Negócio duplicado: para cada (contato, funil) com mais de um negócio
--    ABERTO, fica o mais antigo. As cópias "puras" (sem nenhum evento além da
--    criação e sem nota) são apagadas; antes, a atribuição (UTM) delas passa
--    para o negócio que fica e o reenvio vira um evento 'form_resubmitted' no
--    histórico dele. Cópias que já tiveram movimentação ficam como estão.
--
-- Uma transação só. Tudo vai para _bkp_augra_merge_20260924 antes (tbl =
-- 'pre-sanear-leads-<data>:<tabela>'). Se a contagem final não bater com a
-- prévia, o RAISE desfaz tudo.
--
-- Uso: trocar a conta em `params` e rodar inteiro. NÃO rodar sem OK do Alberto.
-- ============================================================
begin;

create temporary table params on commit drop as
select 'd71dfc27-e01f-46b2-bdd3-cf071ccc6e26'::uuid as account_id,
       'pre-sanear-leads-' || to_char(now(), 'YYYYMMDD') as tag;

-- ── 1. telefones ────────────────────────────────────────────
create temporary table fone_alvo on commit drop as
select c.id, c.phone, c.phone_normalized,
       '55' || c.phone_normalized as novo
from contacts c, params p
where c.account_id = p.account_id
  and c.phone_normalized ~ '^\d{10,11}$'
  and not exists (
    select 1 from contacts t
    where t.account_id = p.account_id and t.phone_normalized = '55' || c.phone_normalized
  );

-- dois contatos sem 55 que virariam o mesmo número (não deveria existir por
-- causa do índice único, mas confere)
do $$ begin
  if exists (select novo from fone_alvo group by novo having count(*) > 1) then
    raise exception 'dois contatos virariam o mesmo telefone — abortado';
  end if;
end $$;

insert into _bkp_augra_merge_20260924 (tbl, row_data, backed_up_at)
select (select tag from params) || ':contacts.phone', to_jsonb(c), now()
from contacts c join fone_alvo f on f.id = c.id;

update contacts c set phone = f.novo
from fone_alvo f where f.id = c.id;

-- ── 2. negócios duplicados ──────────────────────────────────
create temporary table negocio_rank on commit drop as
select d.id, d.contact_id, d.pipeline_id, d.created_at,
       first_value(d.id) over w as fica,
       row_number() over w as rn
from deals d, params p
where d.account_id = p.account_id and d.status = 'open'
window w as (partition by d.contact_id, d.pipeline_id order by d.created_at, d.id);

create temporary table copia_pura on commit drop as
select r.id, r.fica, r.created_at
from negocio_rank r
where r.rn > 1
  and not exists (
    select 1 from deal_events e
    where e.deal_id = r.id and e.type not in ('created', 'created_via_integration')
  )
  and not exists (select 1 from deal_notes n where n.deal_id = r.id)
  and not exists (select 1 from cadence_enrollments ce where ce.deal_id = r.id)
  and not exists (select 1 from ccc_cadencia_log cl where cl.deal_id = r.id);

insert into _bkp_augra_merge_20260924 (tbl, row_data, backed_up_at)
select (select tag from params) || ':deals', to_jsonb(d), now()
from deals d join copia_pura c on c.id = d.id;

insert into _bkp_augra_merge_20260924 (tbl, row_data, backed_up_at)
select (select tag from params) || ':deal_events', to_jsonb(e), now()
from deal_events e join copia_pura c on c.id = e.deal_id;

-- o reenvio fica registrado no negócio que permanece (mesma forma que a rota
-- grava hoje), com o payload/UTM original da cópia
insert into deal_events (deal_id, account_id, type, metadata, created_at)
select c.fica, (select account_id from params), 'form_resubmitted',
       coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('saneado_de', c.id),
       c.created_at
from copia_pura c
left join lateral (
  select metadata from deal_events
  where deal_id = c.id and type = 'created_via_integration'
  order by created_at limit 1
) e on true;

update lead_attribution la set deal_id = c.fica
from copia_pura c where la.deal_id = c.id;

delete from deals d using copia_pura c where d.id = c.id;

-- ── conferência ─────────────────────────────────────────────
do $$
declare
  restam_sem55 int;
  gemeos int;
  dups_abertos int;
  dups_com_historia int;
begin
  select count(*) into restam_sem55
  from contacts c, params p
  where c.account_id = p.account_id and c.phone_normalized ~ '^\d{10,11}$';

  select count(*) into gemeos
  from contacts c, params p
  where c.account_id = p.account_id and c.phone_normalized ~ '^\d{10,11}$'
    and exists (select 1 from contacts t where t.account_id = p.account_id
                and t.phone_normalized = '55' || c.phone_normalized);

  select count(*) into dups_abertos
  from (select 1 from deals d, params p
        where d.account_id = p.account_id and d.status = 'open'
        group by d.contact_id, d.pipeline_id having count(*) > 1) x;

  if restam_sem55 <> gemeos then
    raise exception 'sobrou telefone sem 55 que não é gêmeo (% vs %)', restam_sem55, gemeos;
  end if;
  raise notice 'contatos com 55 corrigido: %', (select count(*) from fone_alvo);
  raise notice 'gêmeos deixados para fundir à mão: %', gemeos;
  raise notice 'cópias de negócio apagadas: %', (select count(*) from copia_pura);
  raise notice 'pares (contato, funil) ainda com 2+ negócios abertos (cópias com história): %', dups_abertos;
end $$;

commit;
