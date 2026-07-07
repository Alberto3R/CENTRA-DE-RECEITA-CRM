-- ============================================================
-- 047_cadence_steps.sql — cadência editável por conta (self-service)
--
-- Antes a sequência de toques era fixa no código (cadence/route.ts).
-- Agora cada conta monta a sua no Painel Outbound → Cadência. Fallback:
-- conta sem passos cadastrados usa a lista padrão do sistema
-- (src/lib/outbound/cadence.ts).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cadence_steps (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  dia         integer NOT NULL DEFAULT 0,   -- offset em dias desde a inscrição
  canal       text    NOT NULL,             -- ex.: Ligação, WhatsApp, E-mail
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cadence_steps_account_idx
  ON public.cadence_steps(account_id, position);

ALTER TABLE public.cadence_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read cadence_steps" ON public.cadence_steps;
CREATE POLICY "members read cadence_steps" ON public.cadence_steps
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "admins write cadence_steps" ON public.cadence_steps;
CREATE POLICY "admins write cadence_steps" ON public.cadence_steps
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Auto-enroll agora agenda o 1º toque pelo `dia` do primeiro passo da conta
-- (fallback 0 = hoje). Mantém o escopo ao pipeline "Outbound SDR".
CREATE OR REPLACE FUNCTION public.auto_enroll_cadence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage text; v_pipe text; v_first_dia int;
BEGIN
  SELECT ps.name, p.name INTO v_stage, v_pipe
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id
  WHERE ps.id = NEW.stage_id;

  IF v_pipe = 'Outbound SDR' AND v_stage = 'Em cadência' THEN
    SELECT dia INTO v_first_dia
    FROM public.cadence_steps
    WHERE account_id = NEW.account_id
    ORDER BY position LIMIT 1;
    v_first_dia := COALESCE(v_first_dia, 0);

    INSERT INTO public.cadence_enrollments (account_id, deal_id, user_id, proximo_em)
    VALUES (
      NEW.account_id, NEW.id, NEW.user_id,
      ((now() AT TIME ZONE 'America/Sao_Paulo')::date + v_first_dia)
    )
    ON CONFLICT (deal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
