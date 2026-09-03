-- ============================================================
-- 094_account_suspension_notice.sql — aviso fixado de suspensão de acesso
--
-- Quando uma conta cancela a assinatura (ou fica inadimplente) e vamos
-- cortar o acesso numa data, gravamos o prazo aqui. O topo do dashboard
-- lê estas colunas e mostra um aviso fixado com contagem regressiva
-- (src/components/billing/subscription-banner.tsx).
--
-- Só isso: a coluna é o AVISO, não o corte. O bloqueio efetivo do CRM
-- ainda não existe (o gating por plano em src/lib/billing/quota.ts vale
-- apenas para as capacidades de IA) — quando existir, é esta data que
-- ele deve consultar.
-- ============================================================

ALTER TABLE public.accounts
  -- Data/hora em que o acesso será suspenso. NULL = sem aviso.
  ADD COLUMN IF NOT EXISTS access_suspends_at timestamptz,
  -- Texto curto do motivo, exibido no aviso. NULL = usa o texto padrão.
  ADD COLUMN IF NOT EXISTS suspension_reason text;

COMMENT ON COLUMN public.accounts.access_suspends_at IS
  'Prazo do aviso de suspensão de acesso (contagem regressiva no topo do dashboard). Escrita só por service role.';
COMMENT ON COLUMN public.accounts.suspension_reason IS
  'Motivo curto mostrado no aviso de suspensão. NULL = texto padrão.';

-- O UPDATE em accounts é liberado para admin da própria conta
-- (policy accounts_update). Sem isto, o cliente avisado poderia
-- simplesmente limpar o próprio prazo pela API. O trigger congela as
-- duas colunas para qualquer papel que não seja service_role.
CREATE OR REPLACE FUNCTION public.freeze_account_suspension_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true) IS NOT NULL
     AND coalesce(
           (current_setting('request.jwt.claims', true)::jsonb ->> 'role'),
           ''
         ) <> 'service_role'
  THEN
    NEW.access_suspends_at := OLD.access_suspends_at;
    NEW.suspension_reason  := OLD.suspension_reason;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_freeze_suspension_fields ON public.accounts;
CREATE TRIGGER accounts_freeze_suspension_fields
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_account_suspension_fields();
