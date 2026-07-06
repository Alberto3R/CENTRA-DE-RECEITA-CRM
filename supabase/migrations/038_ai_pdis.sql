-- ============================================================
-- 038_ai_ai_pdis.sql — motor DESENVOLVE (parecer + PDI)
--
-- `ai_pdis`: parecer honesto + Plano de Desenvolvimento Individual (90 dias) de um
-- vendedor (`seller`). Invariante herdada do HEAD: o PDI nasce RASCUNHO e só vira
-- ASSINADO quando um gestor assina — aqui, um admin+ da conta (assinado_por).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_pdis (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  seller_id     uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  parecer_texto text,
  plano_90d     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- rascunho | assinado
  status        text NOT NULL DEFAULT 'rascunho',
  assinado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assinado_em   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_pdis_account_idx ON public.ai_pdis(account_id);
CREATE INDEX IF NOT EXISTS ai_pdis_seller_idx ON public.ai_pdis(seller_id);

ALTER TABLE public.ai_pdis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read ai_pdis" ON public.ai_pdis;
CREATE POLICY "members read ai_pdis" ON public.ai_pdis
  FOR SELECT USING (public.is_account_member(account_id));

-- Agentes criam/editam rascunhos.
DROP POLICY IF EXISTS "agents write ai_pdis" ON public.ai_pdis;
CREATE POLICY "agents write ai_pdis" ON public.ai_pdis
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));
