-- 116 · Agente 3R nos grupos de WhatsApp dos clientes.
--
-- Um número dedicado (Z-API, fora da API oficial: a coexistência não sincroniza
-- grupos e a Groups API oficial só aceita grupos de até 8 pessoas criados por
-- ela) participa do grupo de cada cliente. Quando é marcado, entende o pedido,
-- mostra o plano e só executa depois do "ok" de quem pediu.
--
-- Segurança: o grupo só mexe na conta a que foi VINCULADO, e o vínculo exige
-- um código gerado por um admin da conta (group_link_codes). Sem vínculo, o
-- agente não faz nada além de explicar como vincular.
-- Escrita: só o service role (webhook). Membros da conta leem.

create table if not exists public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  -- id do grupo como a Z-API entrega em `phone` (ex.: 120363...-group)
  group_jid text not null unique,
  name text,
  account_id uuid references public.accounts(id) on delete set null,
  linked_at timestamptz,
  linked_by_phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_groups enable row level security;

create policy "membros veem os grupos da conta"
  on public.whatsapp_groups for select
  using (account_id is not null and public.is_account_member(account_id));

create policy "admins desligam grupos da conta"
  on public.whatsapp_groups for update
  using (account_id is not null and public.is_account_member(account_id, 'admin'::account_role_enum))
  with check (account_id is not null and public.is_account_member(account_id, 'admin'::account_role_enum));

-- Código de vínculo: gerado por admin da conta, vale 24 h, uso único.
create table if not exists public.group_link_codes (
  code text primary key check (code ~ '^VINCULAR-[A-Z0-9]{6}$'),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz,
  used_by_group uuid references public.whatsapp_groups(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.group_link_codes enable row level security;

create policy "admins veem os códigos da conta"
  on public.group_link_codes for select
  using (public.is_account_member(account_id, 'admin'::account_role_enum));

create policy "admins geram códigos da conta"
  on public.group_link_codes for insert
  with check (public.is_account_member(account_id, 'admin'::account_role_enum));

-- Cada pedido feito ao agente: o que foi pedido, o plano, o que foi feito.
create table if not exists public.group_agent_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.whatsapp_groups(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  -- id da mensagem na Z-API: dedupe de reentrega do webhook
  message_id text not null unique,
  requester_phone text,
  requester_name text,
  request_text text not null,
  status text not null check (status in (
    'awaiting_confirmation', 'executing', 'done', 'failed',
    'cancelled', 'expired', 'answered', 'not_linked', 'error'
  )),
  plan jsonb,
  summary text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists group_agent_requests_pending_idx
  on public.group_agent_requests (group_id, requester_phone, created_at desc)
  where status = 'awaiting_confirmation';

alter table public.group_agent_requests enable row level security;

create policy "membros veem os pedidos ao agente"
  on public.group_agent_requests for select
  using (account_id is not null and public.is_account_member(account_id));
