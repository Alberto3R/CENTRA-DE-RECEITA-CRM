-- Calls agendadas pelo agente — registro DENTRO do CRM.
-- ============================================================
-- Até agora a call marcada pelo agente vivia SÓ no Google Calendar; o CRM não
-- tinha visibilidade (por isso "sumia"). Esta tabela guarda cada agendamento
-- feito via ferramenta `agendar_call`, pra mostrar no card do contato/conversa.
--
-- Escrita: só o runtime do agente (service role, supabaseAdmin) insere.
-- Leitura: qualquer membro da conta (aparece na sidebar da conversa).

CREATE TABLE IF NOT EXISTS public.scheduled_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  channel_id      uuid REFERENCES public.whatsapp_config(id) ON DELETE SET NULL,
  google_event_id text,
  calendar_id     text,
  meet_link       text,
  html_link       text,
  summary         text,
  attendee_email  text,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled',   -- scheduled | cancelled
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_calls_contact_idx
  ON public.scheduled_calls (contact_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS scheduled_calls_account_idx
  ON public.scheduled_calls (account_id, starts_at DESC);

ALTER TABLE public.scheduled_calls ENABLE ROW LEVEL SECURITY;

-- Leitura: membros da conta. (is_account_member já existe no schema.)
CREATE POLICY scheduled_calls_select ON public.scheduled_calls
  FOR SELECT USING (public.is_account_member(account_id));

-- Sem policy de escrita: INSERT/UPDATE só pelo service role (runtime do agente),
-- que dá bypass de RLS. O cliente nunca grava agendamento direto.
