-- ============================================================
-- 043_sdr_activities.sql — log de atividades de prospecção (Outbound SDR)
--
-- Base dos KPIs de atividade do painel do dia: ligações, atendimentos,
-- conversas com decisor, reuniões agendadas, leads qualificados. Uma linha
-- por evento registrado pelo SDR (ou auto-logado depois pelo WhatsApp).
-- RLS padrão da casa (is_account_member).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sdr_activities (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- o SDR
  contact_id  uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  deal_id     uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  -- call | whatsapp | email | meeting | qualification
  tipo        text NOT NULL,
  -- só para call: no_answer | connected | decision_maker
  resultado   text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sdr_activities_account_created_idx
  ON public.sdr_activities(account_id, created_at);
CREATE INDEX IF NOT EXISTS sdr_activities_user_idx
  ON public.sdr_activities(user_id);

ALTER TABLE public.sdr_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read sdr_activities" ON public.sdr_activities;
CREATE POLICY "members read sdr_activities" ON public.sdr_activities
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "agents write sdr_activities" ON public.sdr_activities;
CREATE POLICY "agents write sdr_activities" ON public.sdr_activities
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));
