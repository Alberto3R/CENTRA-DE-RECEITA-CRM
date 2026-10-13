-- 117 · Relatório de Aquisição: o FUNIL vence a origem do lead.
--
-- A tela de canais passou a perguntar "negócios deste funil contam como…".
-- Para essa promessa valer, um canal que reivindica o funil precisa ganhar de
-- um canal que só casa pela origem do contato (ex.: negócio do funil
-- Congressos cujo contato veio de anúncio meses antes conta como Eventos).
-- Única mudança em relação à 115: a ordenação na escolha do canal.

create or replace function public.acquisition_report(
  p_account_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_from timestamptz := (p_from::timestamp at time zone v_tz);
  v_to   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
  v_model text := 'first_touch';
  v_window int := 90;
  v_excluded uuid[] := '{}';
  v_margin numeric;
  v_commission numeric;
  v_currency text;
  v_default_paid uuid;
  v_result jsonb;
begin
  if not public.is_account_member(p_account_id) then
    raise exception 'forbidden';
  end if;

  select s.attribution_model, s.attribution_window_days, s.excluded_pipeline_ids,
         s.margin_pct, s.commission_pct
    into v_model, v_window, v_excluded, v_margin, v_commission
    from acquisition_settings s where s.account_id = p_account_id;
  v_model := coalesce(v_model, 'first_touch');
  v_window := coalesce(v_window, 90);
  v_excluded := coalesce(v_excluded, '{}');

  select a.default_currency into v_currency from accounts a where a.id = p_account_id;

  select c.id into v_default_paid
    from acquisition_channels c
   where c.account_id = p_account_id and c.kind = 'paid'
   order by c.position limit 1;

  with
  ch as (
    select * from acquisition_channels where account_id = p_account_id
  ),
  d as (
    select dl.id, dl.contact_id, dl.pipeline_id, dl.created_at, dl.closed_at,
           dl.status, coalesce(dl.value, 0) as value,
           (dl.created_at >= v_from and dl.created_at < v_to) as is_lead,
           (dl.status = 'won' and dl.closed_at >= v_from and dl.closed_at < v_to) as is_sale
      from deals dl
     where dl.account_id = p_account_id
       and coalesce(dl.pipeline_id = any (v_excluded), false) = false
       and ((dl.created_at >= v_from and dl.created_at < v_to)
            or (dl.status = 'won' and dl.closed_at >= v_from and dl.closed_at < v_to))
  ),
  dt as (
    select d.*, t.source, t.utm_source, t.utm_medium, t.utm_campaign, t.utm_content, t.ad_id
      from d
      left join lateral (
        select la.source, la.utm_source, la.utm_medium, la.utm_campaign, la.utm_content, la.ad_id
          from lead_attribution la
         where la.account_id = p_account_id
           and la.contact_id = d.contact_id
           and (la.deal_id = d.id
                or (la.created_at <= d.created_at + interval '1 hour'
                    and la.created_at >= d.created_at - make_interval(days => v_window)))
         order by (la.deal_id is not distinct from d.id) desc,
                  case when v_model = 'first_touch' then la.created_at end asc,
                  case when v_model = 'last_touch' then la.created_at end desc
         limit 1
      ) t on true
  ),
  dc as (
    select dt.*, c.id as channel_id
      from dt
      left join lateral (
        select c.id from ch c
         where exists (select 1 from unnest(c.match_sources) x where lower(x) = lower(dt.source))
            or exists (select 1 from unnest(c.match_utm_sources) x where lower(x) = lower(dt.utm_source))
            or exists (select 1 from unnest(c.match_utm_mediums) x where lower(x) = lower(dt.utm_medium))
            or dt.pipeline_id = any (c.match_pipeline_ids)
         -- o funil vence a origem: "todo negócio deste funil conta como X"
         order by coalesce(dt.pipeline_id = any (c.match_pipeline_ids), false) desc, c.position
         limit 1
      ) c on true
  ),
  -- anúncio → campanha (qualquer data), para achar a campanha de quem só tem ad_id
  ad_map as (
    select distinct on (s.ad_id) s.ad_id, s.campaign_id, s.campaign_name
      from ad_spend_daily s
     where s.account_id = p_account_id
     order by s.ad_id, s.date desc
  ),
  dk as (
    select dc.*,
           coalesce(m1.campaign_id, m2.campaign_id, nullif(dc.utm_campaign, '')) as campaign_key
      from dc
      left join ad_map m1 on m1.ad_id = dc.ad_id
      left join ad_map m2 on m2.ad_id = dc.utm_content
  ),
  sp as (
    select s.*, coalesce(a.channel_id, v_default_paid) as channel_id
      from ad_spend_daily s
      join ad_accounts a on a.id = s.ad_account_id
     where s.account_id = p_account_id
       and s.date >= p_from and s.date <= p_to
  ),
  -- Custos fora da mídia (lançados por mês): rateados pelos dias do mês
  -- que caem dentro do período.
  oc as (
    select c.channel_id,
           c.amount * greatest(0,
             (least(p_to, (c.month + interval '1 month' - interval '1 day')::date)
              - greatest(p_from, c.month)) + 1
           )::numeric
           / extract(day from (c.month + interval '1 month' - interval '1 day'))::numeric as amount
      from acquisition_costs c
     where c.account_id = p_account_id
       and c.month <= p_to
       and (c.month + interval '1 month') > p_from
  ),
  by_channel as (
    select k.channel_id,
           coalesce(sum(k.leads), 0) as leads,
           coalesce(sum(k.sales), 0) as sales,
           coalesce(sum(k.revenue), 0) as revenue,
           coalesce(sum(k.won_no_value), 0) as won_no_value,
           coalesce(sum(k.spend), 0) as media_spend,
           coalesce(sum(k.other_cost), 0) as other_cost,
           coalesce(sum(k.meta_leads), 0) as meta_leads
      from (
        select dk.channel_id,
               count(*) filter (where dk.is_lead) as leads,
               count(*) filter (where dk.is_sale) as sales,
               sum(dk.value) filter (where dk.is_sale) as revenue,
               count(*) filter (where dk.is_sale and dk.value <= 0) as won_no_value,
               0::numeric as spend, 0::numeric as other_cost, 0::bigint as meta_leads
          from dk group by dk.channel_id
        union all
        select sp.channel_id, 0, 0, 0, 0, sum(sp.spend), 0, sum(sp.meta_leads)
          from sp group by sp.channel_id
        union all
        select oc.channel_id, 0, 0, 0, 0, 0, sum(oc.amount), 0
          from oc group by oc.channel_id
      ) k
     group by k.channel_id
  ),
  campaigns as (
    select coalesce(x.campaign_key, y.campaign_id) as campaign_key,
           coalesce(y.campaign_name, x.campaign_key) as campaign_name,
           coalesce(y.spend, 0) as spend,
           coalesce(y.meta_leads, 0) as meta_leads,
           coalesce(x.leads, 0) as leads,
           coalesce(x.sales, 0) as sales,
           coalesce(x.revenue, 0) as revenue
      from (
        select dk.campaign_key,
               count(*) filter (where dk.is_lead) as leads,
               count(*) filter (where dk.is_sale) as sales,
               coalesce(sum(dk.value) filter (where dk.is_sale), 0) as revenue
          from dk where dk.campaign_key is not null
         group by dk.campaign_key
      ) x
      full outer join (
        select sp.campaign_id, max(sp.campaign_name) as campaign_name,
               sum(sp.spend) as spend, sum(sp.meta_leads) as meta_leads
          from sp where sp.campaign_id is not null
         group by sp.campaign_id
      ) y on y.campaign_id = x.campaign_key
  ),
  weekly as (
    select w.week, sum(w.spend) as spend, sum(w.revenue) as revenue,
           sum(w.leads) as leads, sum(w.sales) as sales
      from (
        select date_trunc('week', (dk.created_at at time zone v_tz))::date as week,
               0::numeric as spend, 0::numeric as revenue, 1 as leads, 0 as sales
          from dk where dk.is_lead
        union all
        select date_trunc('week', (dk.closed_at at time zone v_tz))::date, 0, dk.value, 0, 1
          from dk where dk.is_sale
        union all
        select date_trunc('week', sp.date)::date, sp.spend, 0, 0, 0 from sp
      ) w
     group by w.week
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'currency', coalesce(v_currency, 'BRL'),
    'settings', jsonb_build_object(
      'attribution_model', v_model,
      'attribution_window_days', v_window,
      'margin_pct', v_margin,
      'commission_pct', v_commission
    ),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel_id', b.channel_id,
               'name', coalesce(c.name, 'Não identificado'),
               'kind', c.kind,
               'position', coalesce(c.position, 999999),
               'leads', b.leads, 'sales', b.sales, 'revenue', b.revenue,
               'won_no_value', b.won_no_value,
               'spend', round(b.media_spend + b.other_cost, 2),
               'media_spend', b.media_spend,
               'other_cost', round(b.other_cost, 2),
               'meta_leads', b.meta_leads
             ) order by coalesce(c.position, 999999))
        from by_channel b left join ch c on c.id = b.channel_id
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(to_jsonb(cp) order by cp.spend desc, cp.revenue desc, cp.leads desc)
        from campaigns cp
    ), '[]'::jsonb),
    'weekly', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.week) from weekly w
    ), '[]'::jsonb),
    'spend_currencies', coalesce((
      select jsonb_agg(distinct sp.currency) from sp where sp.currency is not null
    ), '[]'::jsonb),
    'ad_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'external_id', a.external_id, 'name', a.name,
               'last_synced_at', a.last_synced_at, 'last_sync_error', a.last_sync_error))
        from ad_accounts a where a.account_id = p_account_id and a.active
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.acquisition_report(uuid, date, date) to authenticated;
