-- ============================================================
-- 124_agenda_reservas_externas.sql — reservas feitas FORA do CRM
--
-- Até aqui o CRM só conhecia a call que o próprio agente marcava
-- (agendar_call → scheduled_calls). Quem reservava pela página de
-- agendamento do Google (ex.: a agenda do produto na conta da Amanda)
-- ficava invisível: ninguém sabia que a pessoa tinha marcado, ninguém
-- confirmava, e a sessão virava no-show.
--
-- Esta migration guarda a configuração da leitura da agenda e prepara
-- scheduled_calls / scheduled_messages para ela. O worker é
-- src/lib/google/booking-sync.ts; o agendador fica na 125 (só depois
-- do deploy).
-- ============================================================

create table if not exists public.calendar_booking_sync (
  account_id          uuid primary key references public.accounts(id) on delete cascade,
  enabled             boolean not null default true,
  -- HSMs (precisam estar APPROVED). Ambos recebem os MESMOS 3 parâmetros:
  --   {{1}} primeiro nome · {{2}} quando ("terça, 25/11, às 15h") · {{3}} link da sala
  confirm_template    text,
  reminder_template   text,
  -- Minutos antes do início em que cada lembrete sai.
  reminder_offsets_min integer[] not null default '{1440,60}',
  -- Tag aplicada a quem reservou (criada na hora se não existir).
  tag_name            text default 'Agendou sessão',
  -- Depois da confirmação a conversa vai pro time (IA desligada nela):
  -- a sessão precisa de contato humano antes, é o que segura o no-show.
  handoff_to_human    boolean not null default true,
  last_synced_at      timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.calendar_booking_sync enable row level security;

drop policy if exists calendar_booking_sync_select on public.calendar_booking_sync;
create policy calendar_booking_sync_select on public.calendar_booking_sync
  for select using (public.is_account_member(account_id));

drop policy if exists calendar_booking_sync_write on public.calendar_booking_sync;
create policy calendar_booking_sync_write on public.calendar_booking_sync
  for all using (public.is_account_member(account_id, 'admin'::account_role_enum))
  with check (public.is_account_member(account_id, 'admin'::account_role_enum));

-- De onde veio a call: 'agent' (agendar_call) ou 'booking_page' (reserva lida
-- da agenda). O worker NÃO mexe nas do agente — ele já confirma pela conversa.
alter table public.scheduled_calls
  add column if not exists source               text not null default 'agent',
  add column if not exists attendee_name        text,
  add column if not exists attendee_phone       text,
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists updated_at           timestamptz not null default now();

-- Um evento do Google = uma call por conta (o worker relê eventos editados).
create unique index if not exists scheduled_calls_conta_evento_uq
  on public.scheduled_calls (account_id, google_event_id)
  where google_event_id is not null;

-- Lembrete ligado à call: remarcou ou cancelou → os pendentes são cancelados.
alter table public.scheduled_messages
  add column if not exists scheduled_call_id uuid references public.scheduled_calls(id) on delete set null;

create index if not exists scheduled_messages_call_idx
  on public.scheduled_messages (scheduled_call_id)
  where scheduled_call_id is not null;

-- Segredo do cron (mesmo esquema das outras rotas de dreno).
insert into public.app_config (key, value)
select 'booking_sync_cron_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where not exists (select 1 from public.app_config where key = 'booking_sync_cron_secret');
