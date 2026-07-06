-- ============================================================
-- 042_usage_counter_delta.sql — incremento de contador com valor (créditos)
--
-- O sistema de créditos do Gestor debita N créditos por ação (peso por tipo).
-- A RPC 040 só incrementava de 1 em 1; esta sobrecarga aceita `p_delta`.
-- Mantém a de 3 args (040) por compatibilidade; esta é a de 4 args.
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  p_account_id uuid,
  p_periodo    text,
  p_unidade    text,
  p_delta      integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_counters (account_id, periodo, unidade, contador, updated_at)
  VALUES (p_account_id, p_periodo, p_unidade, GREATEST(0, p_delta), now())
  ON CONFLICT (account_id, periodo, unidade)
  DO UPDATE SET contador = public.usage_counters.contador + GREATEST(0, p_delta),
                updated_at = now();
END;
$$;
