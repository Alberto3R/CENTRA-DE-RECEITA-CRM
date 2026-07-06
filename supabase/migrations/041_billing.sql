-- ============================================================
-- 041_billing.sql — assinaturas e planos (Stripe)
--
-- Adiciona colunas de plano/assinatura em `accounts` e a tabela `subscriptions`
-- (espelho local do estado do Stripe). O webhook do Stripe (escrito pela service
-- role) é a ÚNICA via de escrita de subscriptions — clientes só leem.
--
-- Planos: free (default) | pro | enterprise. Os limites vivem no código
-- (src/lib/billing/plans.ts); aqui guardamos só qual plano a conta tem.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id             uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text UNIQUE,
  -- free | pro | enterprise
  plan                   text NOT NULL DEFAULT 'free',
  -- active | trialing | past_due | canceled | incomplete
  status                 text NOT NULL DEFAULT 'active',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_account_idx ON public.subscriptions(account_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Membros leem a assinatura da própria conta; escrita só via service role (webhook).
DROP POLICY IF EXISTS "members read subscriptions" ON public.subscriptions;
CREATE POLICY "members read subscriptions" ON public.subscriptions
  FOR SELECT USING (public.is_account_member(account_id));
