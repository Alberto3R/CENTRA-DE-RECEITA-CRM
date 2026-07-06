-- ============================================================
-- 039_account_sales_config.sql — generalização do método (mercado aberto)
--
-- Generaliza o `tenant_settings` do HEAD: cada conta configura seu MÉTODO de
-- vendas (3R por padrão, mas SPIN/Sandler/custom também). Os prompts de IA são
-- montados a partir desta config. Sem customização (preset 3R), os motores usam
-- o texto 3R verbatim — zero regressão (ver src/lib/ai/config.ts).
--
-- Seed automático: toda conta nova recebe uma config default (trigger). Contas
-- existentes recebem via backfill no fim da migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_sales_config (
  account_id    uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- "3R" (default) | "SPIN" | "Sandler" | custom
  metodo_nome   text NOT NULL DEFAULT '3R',
  -- persona/tom de voz do analista; null = padrão do método
  tom_de_voz    text,
  icp           jsonb,
  produto       jsonb,
  oferta        jsonb,
  -- array de { key, label, descricao }; null = usar as 7 dimensões 3R
  dimensoes     jsonb,
  rubricas      jsonb,
  -- pode espelhar os pipeline_stages da conta
  etapas_funil  jsonb,
  moeda         text NOT NULL DEFAULT 'BRL',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_sales_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read sales config" ON public.account_sales_config;
CREATE POLICY "members read sales config" ON public.account_sales_config
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "admins write sales config" ON public.account_sales_config;
CREATE POLICY "admins write sales config" ON public.account_sales_config
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Seed default ao criar a conta. Trigger separado de handle_new_user (não toca
-- naquela função) — dispara após o INSERT em accounts. Herda a moeda da conta.
CREATE OR REPLACE FUNCTION public.seed_account_sales_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.account_sales_config (account_id, moeda)
  VALUES (NEW.id, COALESCE(NEW.default_currency, 'BRL'))
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_account_sales_config ON public.accounts;
CREATE TRIGGER trg_seed_account_sales_config
  AFTER INSERT ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_account_sales_config();

-- Backfill das contas existentes (preset 3R, moeda herdada).
INSERT INTO public.account_sales_config (account_id, moeda)
SELECT a.id, COALESCE(a.default_currency, 'BRL')
FROM public.accounts a
ON CONFLICT (account_id) DO NOTHING;
