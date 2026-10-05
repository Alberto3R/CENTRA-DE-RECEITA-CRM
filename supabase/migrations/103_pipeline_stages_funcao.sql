-- ============================================================
-- 103_pipeline_stages_funcao.sql — a FUNÇÃO de cada etapa do funil
--
-- O nome da etapa é do cliente ("Visita ao salão", "Test drive",
-- "Possibilidade quente"); a função é fixa e é o que o painel mede. Assim
-- qualquer modelo de funil — de loja, imobiliária, pós-graduação — mostra as
-- mesmas taxas (entrada → conexão → compromisso → venda), e renomear ou
-- reordenar etapa não quebra a métrica.
--
-- Funções: entrada · tentativa · conexao · qualificado · compromisso ·
--          proposta · decisao · ganho · perdido · reativacao
--
-- `is_connection` (migration 034) passa a ser derivado da função
-- (funcao = 'conexao'), mantido por trigger para o código antigo seguir
-- funcionando. Etapa criada sem função ganha uma sugerida pelo nome.
-- ============================================================

-- Sugestão pelo nome — usada no backfill e quando alguém cria etapa sem
-- função (código antigo, setup-funil da CCC). Ordem dos testes importa.
create or replace function public.sugerir_funcao_etapa(
  p_name text, p_is_connection boolean, p_position integer
) returns text
language sql immutable
set search_path to 'public'
as $$
  with n as (
    select lower(translate(coalesce(p_name, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as s
  )
  select case
    when p_is_connection then 'conexao'
    when s ~ 'comprou lt' then 'entrada'
    when s ~ '(ganho|comprou|matricul|fechad|^entrou$|venda fechada|apolice emitida|recuperado)' then 'ganho'
    when s ~ '(perdid|reprovad|nao e o momento|off-gate)' then 'perdido'
    when s ~ '(sem resposta|reativ|no.?show|banco de talentos|follow.?up)' then 'reativacao'
    when s ~ '(conex|conectad|em conversa|conversa iniciada|conversa ativa)' then 'conexao'
    when s ~ '(aguardando|negocia|documenta|link enviado|financiamento)' then 'decisao'
    when s ~ '(proposta|orcamento|condicao enviada|cotacao)' then 'proposta'
    when s ~ '(agendad|realizad|visita|quente|test.?drive|compareceu|entrevista|conversa com|demonstra)' then 'compromisso'
    when s ~ '(qualific|possibilidade|avaliacao|oportunidade|proxima turma|aprovad|semente|em analise|convite realizado|treinando|revisao|interessad)' then 'qualificado'
    when s ~ '(prospec|abordagem|cadencia|contato|atendimento|^ia$|convite enviado|pagamento pendente)' then 'tentativa'
    when s ~ '(novo|base|abandonou|baixou|aplicacao|diagnostico feito|inscrit|captad)' then 'entrada'
    when coalesce(p_position, 0) = 0 then 'entrada'
    else 'qualificado'
  end
  from n;
$$;

alter table public.pipeline_stages add column if not exists funcao text;

update public.pipeline_stages
   set funcao = public.sugerir_funcao_etapa(name, is_connection, position)
 where funcao is null;

alter table public.pipeline_stages
  alter column funcao set not null,
  add constraint pipeline_stages_funcao_check check (funcao in (
    'entrada', 'tentativa', 'conexao', 'qualificado', 'compromisso',
    'proposta', 'decisao', 'ganho', 'perdido', 'reativacao'
  ));

-- Mantém funcao ⇄ is_connection coerentes. BEFORE trigger roda antes do
-- NOT NULL, então insert sem funcao recebe a sugerida.
create or replace function public.pipeline_stages_sync_funcao()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if new.funcao is null then
      new.funcao := public.sugerir_funcao_etapa(new.name, coalesce(new.is_connection, false), new.position);
    end if;
  elsif new.funcao is not distinct from old.funcao
        and new.is_connection is distinct from old.is_connection then
    -- Código antigo mexeu só no is_connection: a função acompanha.
    new.funcao := case
      when new.is_connection then 'conexao'
      when old.funcao = 'conexao' then 'qualificado'
      else old.funcao
    end;
  end if;
  new.is_connection := (new.funcao = 'conexao');
  return new;
end;
$$;

drop trigger if exists trg_pipeline_stages_sync_funcao on public.pipeline_stages;
create trigger trg_pipeline_stages_sync_funcao
  before insert or update of funcao, is_connection on public.pipeline_stages
  for each row execute function public.pipeline_stages_sync_funcao();

-- Painel por função. Mesmo contrato de antes + compromisso. Negócio parado
-- numa etapa de perdido/reativação não conta como "chegou" (antes, uma
-- coluna "Perdido" no fim do funil inflava a taxa de conexão).
create or replace function public.dashboard_funnel_metrics()
returns json
language sql
stable
set search_path to 'public'
as $function$
  with marcos as (
    select pipeline_id,
           min(position) filter (where funcao = 'conexao')     as conn_pos,
           min(position) filter (where funcao = 'compromisso') as comp_pos
    from pipeline_stages group by pipeline_id
  ),
  ds as (
    select d.status, d.created_at, d.closed_at, d.lost_reason,
           m.conn_pos, m.comp_pos,
           (m.conn_pos is not null and (d.status = 'won' or
              (ps.position >= m.conn_pos and ps.funcao not in ('perdido', 'reativacao')))) as reached_conn,
           (m.comp_pos is not null and (d.status = 'won' or
              (ps.position >= m.comp_pos and ps.funcao not in ('perdido', 'reativacao')))) as reached_comp
    from deals d
    join pipeline_stages ps on ps.id = d.stage_id
    left join marcos m on m.pipeline_id = d.pipeline_id
  )
  select json_build_object(
    'total_deals',        (select count(*) from ds),
    'with_conn_stage',    (select count(*) from ds where conn_pos is not null),
    'reached_conn',       (select count(*) from ds where reached_conn),
    'won',                (select count(*) from ds where status = 'won'),
    'won_from_conn',      (select count(*) from ds where status = 'won' and reached_conn),
    'conn_with_comp_stage', (select count(*) from ds where reached_conn and comp_pos is not null),
    'reached_comp',       (select count(*) from ds where reached_comp and reached_conn),
    'won_from_comp',      (select count(*) from ds where status = 'won' and reached_comp),
    'lost',               (select count(*) from ds where status = 'lost'),
    'avg_cycle_seconds', (
      select avg(extract(epoch from closed_at - created_at))
      from ds where status = 'won' and closed_at is not null
    ),
    'loss_reasons', (
      select coalesce(json_agg(json_build_object('reason', reason, 'count', n) order by n desc), '[]'::json)
      from (
        select coalesce(nullif(trim(lost_reason), ''), 'Não informado') as reason, count(*) as n
        from ds where status = 'lost' group by 1
      ) x
    ),
    'no_human_followup', (
      select count(*) from conversations cv
      where cv.status = 'open'
        and (select max(created_at) from messages m where m.conversation_id = cv.id and m.sender_type = 'customer')
            > coalesce((select max(created_at) from messages m where m.conversation_id = cv.id and m.sender_type = 'agent'), '-infinity'::timestamptz)
    )
  );
$function$;
