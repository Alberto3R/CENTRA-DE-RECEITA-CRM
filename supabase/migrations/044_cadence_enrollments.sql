-- ============================================================
-- 044_cadence_enrollments.sql — rastreador de cadência (Outbound SDR)
--
-- Cadência = sequência de toques (D0 ligação, D1 WhatsApp, D2 ligação, D4
-- e-mail, D6 ligação, D8 última tentativa). Este é o rastreador de ADESÃO:
-- guarda em que passo cada lead está e quando é o próximo toque. O ENVIO
-- automático continua nas Automações/Fluxos; aqui é a fila "o que fazer hoje".
--
-- Auto-enroll: quando um deal entra numa etapa chamada 'Em cadência' (template
-- Outbound SDR), a inscrição é criada sozinha — sem UI. Só afeta contas que
-- usam essa etapa; AUGRA/EQV/3R (sem ela) nunca disparam o trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cadence_enrollments (
  id           uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- SDR dono do deal
  passo        integer NOT NULL DEFAULT 0,
  enrolled_at  timestamptz NOT NULL DEFAULT now(),
  proximo_em   date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  status       text NOT NULL DEFAULT 'active', -- active | done | paused
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id)
);

CREATE INDEX IF NOT EXISTS cadence_enroll_account_due_idx
  ON public.cadence_enrollments(account_id, status, proximo_em);

ALTER TABLE public.cadence_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read cadence" ON public.cadence_enrollments;
CREATE POLICY "members read cadence" ON public.cadence_enrollments
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "agents write cadence" ON public.cadence_enrollments;
CREATE POLICY "agents write cadence" ON public.cadence_enrollments
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.auto_enroll_cadence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_name text;
BEGIN
  SELECT name INTO v_stage_name FROM public.pipeline_stages WHERE id = NEW.stage_id;
  IF v_stage_name = 'Em cadência' THEN
    INSERT INTO public.cadence_enrollments (account_id, deal_id, user_id)
    VALUES (NEW.account_id, NEW.id, NEW.user_id)
    ON CONFLICT (deal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_enroll_cadence ON public.deals;
CREATE TRIGGER trg_auto_enroll_cadence
  AFTER INSERT OR UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.auto_enroll_cadence();
