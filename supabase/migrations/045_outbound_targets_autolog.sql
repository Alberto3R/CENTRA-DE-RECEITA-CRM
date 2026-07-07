-- ============================================================
-- 045_outbound_targets_autolog.sql
--   1) outbound_targets — metas (dia/mês) editáveis por conta
--   2) auto-log de reunião/qualificação ao mover o deal de etapa
--   3) re-escopa os triggers de outbound para o pipeline "Outbound SDR"
--      (a etapa "Qualificado" também existe em outros funis, ex. Low Tickets
--       da EQV — sem escopo, geraria atividade indevida).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.outbound_targets (
  account_id    uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  dials         integer NOT NULL DEFAULT 50,
  atendimentos  integer NOT NULL DEFAULT 12,
  decisor       integer NOT NULL DEFAULT 6,
  whatsapp      integer NOT NULL DEFAULT 30,
  reunioes      integer NOT NULL DEFAULT 1,
  qualificados  integer NOT NULL DEFAULT 4,
  reunioes_mes  integer NOT NULL DEFAULT 22,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.outbound_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read outbound_targets" ON public.outbound_targets;
CREATE POLICY "members read outbound_targets" ON public.outbound_targets
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "admins write outbound_targets" ON public.outbound_targets;
CREATE POLICY "admins write outbound_targets" ON public.outbound_targets
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Auto-log de etapa: só para deals do pipeline "Outbound SDR".
-- 'Reunião agendada' -> meeting; 'Qualificado' -> qualification.
-- Dedup por (deal, tipo): só a 1ª entrada na etapa conta.
CREATE OR REPLACE FUNCTION public.auto_log_deal_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage text; v_pipe text; v_tipo text;
BEGIN
  SELECT ps.name, p.name INTO v_stage, v_pipe
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id
  WHERE ps.id = NEW.stage_id;

  IF v_pipe IS DISTINCT FROM 'Outbound SDR' THEN RETURN NEW; END IF;

  IF v_stage = 'Reunião agendada' THEN v_tipo := 'meeting';
  ELSIF v_stage = 'Qualificado' THEN v_tipo := 'qualification';
  ELSE RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sdr_activities WHERE deal_id = NEW.id AND tipo = v_tipo
  ) THEN
    INSERT INTO public.sdr_activities (account_id, user_id, contact_id, deal_id, tipo)
    VALUES (NEW.account_id, NEW.user_id, NEW.contact_id, NEW.id, v_tipo);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_auto_log_deal_stage ON public.deals;
CREATE TRIGGER trg_auto_log_deal_stage
  AFTER INSERT OR UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.auto_log_deal_stage();

-- Re-escopa o auto-enroll de cadência (044) para o pipeline Outbound SDR.
CREATE OR REPLACE FUNCTION public.auto_enroll_cadence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage text; v_pipe text;
BEGIN
  SELECT ps.name, p.name INTO v_stage, v_pipe
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id
  WHERE ps.id = NEW.stage_id;

  IF v_pipe = 'Outbound SDR' AND v_stage = 'Em cadência' THEN
    INSERT INTO public.cadence_enrollments (account_id, deal_id, user_id)
    VALUES (NEW.account_id, NEW.id, NEW.user_id)
    ON CONFLICT (deal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
