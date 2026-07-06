-- ============================================================
-- 040_ai_usage.sql — telemetria de custo + contadores de quota
--
-- `ai_usage_events`: 1 linha por chamada de IA (tokens in/out + custo USD estimado).
--   Base do fair use e da margem dos planos. Escrito pela service role.
-- `usage_counters`: contador agregado por (conta, mês, unidade faturável) — para
--   a checagem barata de quota sem varrer ai_usage_events. Incrementado pela RPC
--   `increment_usage_counter` (SECURITY DEFINER), padrão das contadoras do WACRM.
-- ============================================================

-- ---------- ai_usage_events ----------
CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  capacidade  text NOT NULL,
  modelo      text NOT NULL,
  tokens_in   integer NOT NULL DEFAULT 0,
  tokens_out  integer NOT NULL DEFAULT 0,
  custo_usd   numeric NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_account_periodo_idx
  ON public.ai_usage_events(account_id, created_at);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Admins leem o custo da própria conta (dashboard de uso); escrita só service role.
DROP POLICY IF EXISTS "admins read ai_usage_events" ON public.ai_usage_events;
CREATE POLICY "admins read ai_usage_events" ON public.ai_usage_events
  FOR SELECT USING (public.is_account_member(account_id, 'admin'));

-- ---------- usage_counters ----------
CREATE TABLE IF NOT EXISTS public.usage_counters (
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- YYYY-MM
  periodo     text NOT NULL,
  -- unidade faturável: 'analise' | 'geracao'
  unidade     text NOT NULL,
  contador    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, periodo, unidade)
);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read usage_counters" ON public.usage_counters;
CREATE POLICY "members read usage_counters" ON public.usage_counters
  FOR SELECT USING (public.is_account_member(account_id));

-- ---------- RPC de incremento (idempotente, atômico) ----------
CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  p_account_id uuid,
  p_periodo    text,
  p_unidade    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_counters (account_id, periodo, unidade, contador, updated_at)
  VALUES (p_account_id, p_periodo, p_unidade, 1, now())
  ON CONFLICT (account_id, periodo, unidade)
  DO UPDATE SET contador = public.usage_counters.contador + 1,
                updated_at = now();
END;
$$;
