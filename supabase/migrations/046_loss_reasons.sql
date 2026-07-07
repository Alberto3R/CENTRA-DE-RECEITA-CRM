-- ============================================================
-- 046_loss_reasons.sql — motivos de perda editáveis por conta
--
-- Antes era uma lista fixa no código. Agora cada conta cadastra a sua.
-- Fallback: se a conta não tiver nenhum motivo, o deal-form usa a lista
-- padrão do sistema (src/lib/deals/loss-reasons.ts).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.loss_reasons (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loss_reasons_account_idx
  ON public.loss_reasons(account_id, position);

ALTER TABLE public.loss_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read loss_reasons" ON public.loss_reasons;
CREATE POLICY "members read loss_reasons" ON public.loss_reasons
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "admins write loss_reasons" ON public.loss_reasons;
CREATE POLICY "admins write loss_reasons" ON public.loss_reasons
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
