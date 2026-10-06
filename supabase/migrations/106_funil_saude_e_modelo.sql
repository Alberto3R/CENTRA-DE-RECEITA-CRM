-- ============================================================
-- 106_funil_saude_e_modelo.sql — de onde o funil veio e como ele se comporta
--
-- pipelines.modelo_id: o modelo da biblioteca que criou o funil (nulo =
-- montado à mão). É o que vai permitir comparar conversão entre contas do
-- mesmo segmento quando houver contas suficientes.
--
-- pipeline_saude(): por etapa, nos últimos 90 dias — quantos negócios
-- entraram, quanto tempo ficaram (mediana, só de quem já saiu), quantos
-- estão abertos agora e quantos passaram do prazo. As sugestões (juntar,
-- remover, dividir) são calculadas no app a partir disso. SECURITY INVOKER:
-- vale o RLS de quem pergunta, então só enxerga funil da própria conta.
-- ============================================================

alter table public.pipelines add column if not exists modelo_id text;

create or replace function public.pipeline_saude(p_pipeline_id uuid)
returns table (
  stage_id uuid,
  entradas_90d bigint,
  mediana_horas numeric,
  abertos bigint,
  parados bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with etapas as (
    select id, dias_max from pipeline_stages where pipeline_id = p_pipeline_id
  ),
  eventos as (
    select e.deal_id, e.stage_id, e.entered_at,
           lead(e.entered_at) over (partition by e.deal_id order by e.entered_at) as saiu_em
    from deal_stage_events e
    join deals d on d.id = e.deal_id
    where d.pipeline_id = p_pipeline_id
  ),
  passagens as (
    select stage_id,
           count(*) filter (where entered_at > now() - interval '90 days') as entradas_90d,
           percentile_cont(0.5) within group (
             order by extract(epoch from saiu_em - entered_at) / 3600.0
           ) filter (where saiu_em is not null and entered_at > now() - interval '90 days') as mediana_horas
    from eventos group by stage_id
  ),
  agora as (
    select d.stage_id,
           count(*) as abertos,
           count(*) filter (
             where et.dias_max is not null
               and d.stage_entered_at < now() - make_interval(days => et.dias_max)
           ) as parados
    from deals d join etapas et on et.id = d.stage_id
    where d.pipeline_id = p_pipeline_id and coalesce(d.status, 'open') = 'open'
    group by d.stage_id
  )
  select et.id,
         coalesce(p.entradas_90d, 0),
         round(p.mediana_horas::numeric, 1),
         coalesce(a.abertos, 0),
         coalesce(a.parados, 0)
  from etapas et
  left join passagens p on p.stage_id = et.id
  left join agora a on a.stage_id = et.id;
$$;
