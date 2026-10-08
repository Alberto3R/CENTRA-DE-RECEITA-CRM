-- ============================================================
-- 110_resultado_do_agente.sql — o que o agente de atendimento entregou
--
-- Até aqui o agente decidia a cada resposta a intenção do lead, se era hora
-- de passar pro consultor e um resumo — e o CRM jogava tudo fora, guardando
-- só o texto enviado. Nada dizia quantos leads ele qualificou nem quanto
-- custou.
--
-- ai_agente_turnos: uma linha por rodada do agente (o que ele decidiu +
--   tokens e custo). Gravada pelo webhook, service role.
-- ai_agente_avaliacoes: uma linha por conversa — a leitura do trecho em que
--   só o agente falava (antes do consultor assumir): o lead respondeu? o
--   agente qualificou? apresentou a oferta? passou na hora certa? nota e
--   erro. Feita pela revisão automática (/api/ai-agent/avaliar, pg_cron).
-- ai_agent_config.qualificacao_campos: os dados que ESTE agente deve
--   descobrir (ex.: momento de carreira, período). Nulo = a revisão deduz
--   das instruções do agente na primeira vez e grava aqui.
-- agente_resultado(): os números da página "Resultado do agente".
-- ============================================================

alter table public.ai_agent_config
  add column if not exists qualificacao_campos jsonb;

create table if not exists public.ai_agente_turnos (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  agent_id        uuid references public.ai_agent_config(id) on delete set null,
  intencao        text,
  handoff         boolean not null default false,
  handoff_motivo  text,
  resumo          text,
  silencio        boolean not null default false,
  -- a IA não respondeu (erro de API, JSON inválido): a conversa foi pro humano
  falhou          boolean not null default false,
  modelo          text,
  tokens_in       integer not null default 0,
  tokens_out      integer not null default 0,
  custo_usd       numeric(12,6) not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists ai_agente_turnos_conv_idx on public.ai_agente_turnos (conversation_id, created_at);
create index if not exists ai_agente_turnos_conta_idx on public.ai_agente_turnos (account_id, created_at);

create table if not exists public.ai_agente_avaliacoes (
  conversation_id   uuid primary key references public.conversations(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  agent_id          uuid references public.ai_agent_config(id) on delete set null,
  contact_id        uuid references public.contacts(id) on delete set null,
  -- 1ª mensagem do lead, normalizada: mensagem pronta de QR code/landing
  -- agrupa sozinha (ex.: "quero o conteúdo da palestra e saber mais...")
  origem            text,
  inicio_at         timestamptz not null,
  humano_assumiu_at timestamptz,
  msgs_agente       integer not null default 0,
  msgs_lead         integer not null default 0,
  msgs_humano       integer not null default 0,
  resposta_seg      numeric,
  lead_respondeu    boolean not null default false,
  qualificado       boolean not null default false,
  qualificacao      jsonb not null default '{}'::jsonb,
  apresentou_oferta boolean not null default false,
  agente_encaminhou boolean not null default false,
  interesse         text,
  dor               text,
  erro              text,
  nota              smallint check (nota between 1 and 5),
  resumo            text,
  avaliado_ate      timestamptz not null,
  avaliado_em       timestamptz not null default now(),
  modelo            text,
  custo_usd         numeric(12,6) not null default 0
);
create index if not exists ai_agente_avaliacoes_conta_idx on public.ai_agente_avaliacoes (account_id, inicio_at);

alter table public.ai_agente_turnos enable row level security;
alter table public.ai_agente_avaliacoes enable row level security;

create policy "membros veem os turnos do agente"
  on public.ai_agente_turnos for select
  using (public.is_account_member(account_id));

create policy "membros veem as avaliações do agente"
  on public.ai_agente_avaliacoes for select
  using (public.is_account_member(account_id));

-- Fila da revisão automática (service role). Entra a conversa em que o agente
-- rodou e que (a) nunca foi avaliada ou (b) o agente seguiu conversando depois
-- da última avaliação — desde que o consultor já tenha assumido ou a conversa
-- esteja parada há 2h. Depois que o humano assume, o trecho do agente não muda
-- mais: não reavalia (o desfecho vem do funil, ao vivo).
create or replace function public.agente_conversas_para_avaliar(p_limite integer default 25)
returns table (conversation_id uuid, account_id uuid, agent_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.account_id, t.agent_id
  from conversations c
  join lateral (
    select tt.agent_id, min(tt.created_at) as primeiro
    from ai_agente_turnos tt
    where tt.conversation_id = c.id
    group by tt.agent_id
    order by min(tt.created_at)
    limit 1
  ) t on true
  left join ai_agente_avaliacoes a on a.conversation_id = c.id
  where c.last_message_at > now() - interval '30 days'
    and (
      a.conversation_id is null
      or (a.humano_assumiu_at is null and c.last_message_at > a.avaliado_ate + interval '1 minute')
    )
    and (
      c.last_message_at < now() - interval '2 hours'
      or exists (
        select 1 from messages m
        where m.conversation_id = c.id and m.sender_type = 'agent' and m.created_at > t.primeiro
      )
    )
  order by c.last_message_at desc
  limit p_limite;
$$;
revoke all on function public.agente_conversas_para_avaliar(integer) from public, anon, authenticated;

-- Números da página. SECURITY INVOKER: vale o RLS de quem pergunta. A conta
-- vem da tela (marca ativa); sem ela, a de profiles.account_id — nunca soma
-- marcas.
-- Origem: mensagens de abertura que se repetem 3+ vezes viram uma origem
-- (QR code, landing); o resto cai em "__outras__".
create or replace function public.agente_resultado(
  p_account_id uuid default null,
  p_agent_id uuid default null,
  p_desde timestamptz default null,
  p_ate timestamptz default null,
  p_origem text default null
)
returns json
language sql
stable
security invoker
set search_path to 'public'
as $$
  with conta as (
    select coalesce(p_account_id, (select account_id from profiles where user_id = auth.uid() limit 1)) as account_id
  ),
  base as (
    select a.*
    from ai_agente_avaliacoes a, conta
    where a.account_id = conta.account_id
      and (p_agent_id is null or a.agent_id = p_agent_id)
      and (p_desde is null or a.inicio_at >= p_desde)
      and (p_ate is null or a.inicio_at < p_ate)
  ),
  origens as (
    select origem, count(*) as n from base where origem is not null
    group by origem having count(*) >= 3
  ),
  av as (
    select b.*, case when o.origem is null then '__outras__' else b.origem end as origem_grupo
    from base b left join origens o on o.origem = b.origem
    where p_origem is null
       or (p_origem = '__outras__' and o.origem is null)
       or b.origem = p_origem
  ),
  neg as (
    select av.conversation_id,
           max(case when d.status = 'won' then 2
                    when s.funcao in ('qualificado','compromisso','proposta','decisao','ganho') then 1
                    else 0 end) as nivel,
           coalesce(sum(d.value) filter (where d.status = 'won'), 0) as valor_ganho
    from av
    join deals d on d.contact_id = av.contact_id and d.account_id = av.account_id
    left join pipeline_stages s on s.id = d.stage_id
    group by av.conversation_id
  ),
  turnos as (
    select count(*) as n, coalesce(sum(t.custo_usd), 0) as custo,
           count(*) filter (where t.falhou) as falhas
    from ai_agente_turnos t join av on av.conversation_id = t.conversation_id
  ),
  perfil as (
    select q.key as campo, q.value as valor, count(*) as n
    from av, jsonb_each_text(av.qualificacao) q
    where q.value is not null and q.value <> '' and q.value <> 'null' and q.value <> 'desconhecido'
    group by 1, 2
  )
  select json_build_object(
    'funil', (
      select json_build_object(
        'atendidos', count(*),
        'responderam', count(*) filter (where lead_respondeu),
        'qualificados', count(*) filter (where qualificado),
        'ouviram_oferta', count(*) filter (where apresentou_oferta),
        'encaminhados', count(*) filter (where agente_encaminhou),
        'avancaram', (select count(*) from neg where nivel >= 1),
        'ganhos', (select count(*) from neg where nivel = 2),
        'valor_ganho', (select coalesce(sum(valor_ganho), 0) from neg)
      ) from av
    ),
    'mensagens', (
      select json_build_object(
        'agente', coalesce(sum(msgs_agente), 0),
        'lead', coalesce(sum(msgs_lead), 0),
        'humano', coalesce(sum(msgs_humano), 0),
        'resposta_mediana_seg', percentile_cont(0.5) within group (order by resposta_seg),
        'fora_do_horario', count(*) filter (
          where extract(hour from inicio_at at time zone 'America/Sao_Paulo') < 8
             or extract(hour from inicio_at at time zone 'America/Sao_Paulo') >= 20
             or extract(isodow from inicio_at at time zone 'America/Sao_Paulo') >= 6
        )
      ) from av
    ),
    'custo', (
      select json_build_object(
        'turnos', t.n,
        'falhas', t.falhas,
        'agente_usd', t.custo,
        'revisao_usd', (select coalesce(sum(custo_usd), 0) from av)
      ) from turnos t
    ),
    'passagem', (
      select json_build_object(
        'sem_humano', count(*) filter (where humano_assumiu_at is null),
        'agente_encaminhou', count(*) filter (where humano_assumiu_at is not null and agente_encaminhou),
        'humano_antes_do_lead_responder', count(*) filter (where humano_assumiu_at is not null and not agente_encaminhou and not lead_respondeu),
        'humano_no_meio', count(*) filter (where humano_assumiu_at is not null and not agente_encaminhou and lead_respondeu),
        'minutos_ate_humano_mediana', percentile_cont(0.5) within group (
          order by extract(epoch from humano_assumiu_at - inicio_at) / 60
        ) filter (where humano_assumiu_at is not null)
      ) from av
    ),
    'notas', (
      select json_build_object(
        'media', round(avg(nota)::numeric, 2),
        'baixas', count(*) filter (where nota <= 2),
        'com_erro', count(*) filter (where coalesce(erro, '') <> '')
      ) from av
    ),
    'interesse', (
      select coalesce(json_object_agg(coalesce(interesse, 'sem_sinal'), n), '{}'::json)
      from (select interesse, count(*) n from av group by 1) x
    ),
    'perfil', (
      select coalesce(json_agg(json_build_object('campo', campo, 'valor', valor, 'n', n) order by campo, n desc), '[]'::json)
      from perfil
    ),
    'dores', (
      select coalesce(json_agg(x order by x.inicio_at desc), '[]'::json)
      from (
        select conversation_id, dor, inicio_at from av
        where coalesce(dor, '') <> '' order by inicio_at desc limit 20
      ) x
    ),
    'problemas', (
      select coalesce(json_agg(x order by x.inicio_at desc), '[]'::json)
      from (
        select av.conversation_id, av.inicio_at, av.nota, av.erro, av.resumo,
               coalesce(ct.name, ct.phone) as contato
        from av left join contacts ct on ct.id = av.contact_id
        where av.nota <= 2 or coalesce(av.erro, '') <> ''
        order by av.inicio_at desc limit 40
      ) x
    ),
    'origens', (
      select coalesce(json_agg(json_build_object('origem', origem, 'n', n) order by n desc), '[]'::json)
      from (
        select origem, n from origens
        union all
        select '__outras__', count(*) from base b
        where b.origem is null or b.origem not in (select origem from origens)
        having count(*) > 0
      ) o
    )
  );
$$;

grant execute on function public.agente_resultado(uuid, uuid, timestamptz, timestamptz, text) to authenticated;

-- Revisão automática a cada 15 min — padrão 079. Segredo em app_config.
insert into public.app_config (key, value)
values ('agente_avaliacao_cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare v_jobid int;
begin
  select jobid into v_jobid from cron.job where jobname = 'agente-avaliacao';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'agente-avaliacao',
    '*/15 * * * *',
    $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/ai-agent/avaliar',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'agente_avaliacao_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 290000
    );
    $cron$
  );
end $$;
