-- 102 · WhatsApp Business app no CRM (Coexistência da Meta) + dedupe de mensagens
--
-- Coexistência = o MESMO número rodando no app WhatsApp Business do celular e
-- na Cloud API. A Meta espelha no webhook o que o vendedor manda pelo celular
-- (smb_message_echoes), importa até 180 dias de histórico (history) e os
-- contatos da agenda do app (smb_app_state_sync). Plano em
-- docs/WHATSAPP-BUSINESS-APP-CANAL.md.

-- 1. Dedupe de mensagens por (conversation_id, message_id)
--    O webhook nunca deduplicou: retentativa da Meta gravava a mesma mensagem
--    duas vezes (e disparava flows/agente duas vezes). Na coexistência isso
--    piora, porque histórico e echo se sobrepõem. O webhook agora checa antes
--    de gravar; este índice é a trava definitiva no banco.
--
--    Em 02/out/2026 havia 4 pares duplicados em produção. Esta migration NÃO
--    apaga nada: se ainda houver duplicata, o índice não é criado (NOTICE) e
--    precisa ser criado depois que as sobras forem tratadas à mão.
--    NULLs são distintos no Postgres: mensagens sem id externo não colidem.
--    Índice SEM where para o upsert (on_conflict) do PostgREST conseguir usá-lo.
do $$
begin
  if exists (
    select 1 from public.messages
     where message_id is not null
     group by conversation_id, message_id
    having count(*) > 1
  ) then
    raise notice 'messages: há duplicatas por (conversation_id, message_id) — índice único NÃO criado';
  else
    create unique index if not exists messages_conversation_message_id_uniq
      on public.messages (conversation_id, message_id);
  end if;
end $$;

-- 2. Origem da mensagem
--    api     = entrou/saiu pelo CRM (Cloud API, Instagram, e-mail) — o padrão
--    app     = enviada pelo vendedor no app WhatsApp Business do celular
--    history = importada do histórico na conexão da coexistência
--    Os painéis separam o que foi feito no CRM do que foi feito no celular.
alter table public.messages
  add column if not exists origin text not null default 'api';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_origin_check'
  ) then
    alter table public.messages
      add constraint messages_origin_check
      check (origin in ('api', 'app', 'history'));
  end if;
end $$;

-- 3. Canal em modo coexistência
--    display_phone_number já existe em produção (criada fora das migrations;
--    o inbox lê). Declarada aqui para ambiente novo não quebrar.
alter table public.whatsapp_config
  add column if not exists display_phone_number text,
  add column if not exists connection_mode text not null default 'cloud',
  add column if not exists coex_onboarded_at timestamptz,
  add column if not exists coex_contacts_sync_requested_at timestamptz,
  add column if not exists coex_history_sync_requested_at timestamptz,
  add column if not exists coex_history_progress integer,
  add column if not exists coex_history_completed_at timestamptz,
  add column if not exists coex_last_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_config_connection_mode_check'
  ) then
    alter table public.whatsapp_config
      add constraint whatsapp_config_connection_mode_check
      check (connection_mode in ('cloud', 'coexistence'));
  end if;
end $$;

-- 4. Agenda do app (smb_app_state_sync)
--    NÃO vira `contacts` direto: a agenda do celular do vendedor tem contato
--    pessoal, e jogar tudo no CRM poluiria a base (e a LGPD agradece). Fica
--    aqui só para dar NOME aos contatos que de fato conversam no canal.
create table if not exists public.whatsapp_app_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  channel_id uuid not null references public.whatsapp_config(id) on delete cascade,
  phone text not null,
  full_name text,
  first_name text,
  removed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (channel_id, phone)
);

-- Tabela nova nasce SEM RLS no Supabase (anon lê e grava) — liga já.
alter table public.whatsapp_app_contacts enable row level security;

drop policy if exists whatsapp_app_contacts_member_read on public.whatsapp_app_contacts;
create policy whatsapp_app_contacts_member_read
  on public.whatsapp_app_contacts
  for select using (public.is_account_member(account_id));
-- Escrita só pelo service role (webhook).
