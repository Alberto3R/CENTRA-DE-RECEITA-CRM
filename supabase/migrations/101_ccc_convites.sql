-- ============================================================
-- 101_ccc_convites.sql — convite pré-preenchido do Diagnóstico
--
-- O formulário /diagnostico é público e não sabe de qual conta o cliente
-- é: a resposta caía com account_id NULL e alguém tinha que amarrar na mão.
-- O convite resolve as duas coisas. O link leva só um token opaco
-- (/diagnostico?c=<token>) — nome e telefone NUNCA vão na URL, porque URL
-- fica em histórico, prévia do WhatsApp e log. O form busca o pré-preenchido
-- pelo token, e o POST herda o account_id do convite no servidor.
--
-- RLS ligado e sem policy: só o service role (rotas /api/diagnostico) lê e
-- grava. Tabela nova no public sem RLS fica aberta pro anon.
-- ============================================================

create table if not exists public.ccc_convites (
  token          text primary key,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  nome           text,
  empresa        text,
  whatsapp       text,
  respostas      jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  usado_em       timestamptz,
  diagnostico_id uuid references public.ccc_diagnosticos(id) on delete set null
);

alter table public.ccc_convites enable row level security;

create index if not exists ccc_convites_account_idx on public.ccc_convites(account_id);
