-- 111 · Chat de ajuda dentro do CRM
--
-- Cada pergunta feita no chat de ajuda (botão "Ajuda" no topo) e a resposta
-- dada com base na Central de Ajuda. Serve para:
--   1. limitar o volume por usuário (trava anti-abuso, contada na rota);
--   2. mostrar à Sales 3R o que as pessoas perguntam e o que a Central NÃO
--      responde (encontrou = false) — é a fila de artigos a escrever.
--
-- RLS na mesma migration (tabela nova no public nasce aberta para anon).
-- O usuário grava e lê só as próprias linhas; a leitura geral é pelo
-- service role (painel interno).

create table if not exists public.ajuda_chat_logs (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  pergunta    text not null,
  resposta    text not null,
  artigos     text[] not null default '{}',
  encontrou   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists ajuda_chat_logs_user_created_idx
  on public.ajuda_chat_logs (user_id, created_at desc);
create index if not exists ajuda_chat_logs_nao_encontrou_idx
  on public.ajuda_chat_logs (created_at desc) where not encontrou;

alter table public.ajuda_chat_logs enable row level security;

drop policy if exists ajuda_chat_logs_insert_proprio on public.ajuda_chat_logs;
create policy ajuda_chat_logs_insert_proprio on public.ajuda_chat_logs
  for insert to authenticated
  with check (user_id = auth.uid() and is_account_member(account_id));

drop policy if exists ajuda_chat_logs_select_proprio on public.ajuda_chat_logs;
create policy ajuda_chat_logs_select_proprio on public.ajuda_chat_logs
  for select to authenticated
  using (user_id = auth.uid());
