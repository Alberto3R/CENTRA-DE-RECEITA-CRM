-- ============================================================
-- 107_funil_compartilhado.sql — compartilhar a ESTRUTURA de um funil
--
-- O link leva só uma cópia das etapas (nome, função, prazo, régua, cor) —
-- nunca negócio, contato ou dado de cliente. Quem abre o link, logado,
-- importa na própria conta. Serve para a 3R replicar um funil que funciona
-- em vários clientes e para quem tem mais de uma marca.
--
-- Leitura por token só via RPC (security definer, devolve nome + etapas):
-- a tabela em si só é visível para membros da conta que compartilhou.
-- ============================================================

create table if not exists public.funil_compartilhamentos (
  token       text primary key,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  nome        text not null,
  etapas      jsonb not null check (jsonb_typeof(etapas) = 'array'),
  criado_por  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  usos        integer not null default 0
);

alter table public.funil_compartilhamentos enable row level security;

create policy "membros veem os compartilhamentos da conta"
  on public.funil_compartilhamentos for select
  using (public.is_account_member(account_id));

create policy "admins compartilham funis da conta"
  on public.funil_compartilhamentos for insert
  with check (public.is_account_member(account_id, 'admin'::account_role_enum) and criado_por = auth.uid());

create or replace function public.funil_compartilhado(p_token text)
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  select json_build_object('nome', nome, 'etapas', etapas)
  from funil_compartilhamentos
  where token = p_token and auth.uid() is not null;
$$;

create or replace function public.funil_compartilhado_usado(p_token text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update funil_compartilhamentos set usos = usos + 1
  where token = p_token and auth.uid() is not null;
$$;

revoke all on function public.funil_compartilhado(text) from public, anon;
revoke all on function public.funil_compartilhado_usado(text) from public, anon;
grant execute on function public.funil_compartilhado(text) to authenticated;
grant execute on function public.funil_compartilhado_usado(text) to authenticated;
