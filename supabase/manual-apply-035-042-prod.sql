-- ============================================================================
-- APLICAÇÃO MANUAL — migrations 035–042 (billing + IA Gestor Comercial) em PROD
-- Projeto Supabase: uymmbqockiqcpporluxk (sales-3r-crm)
--
-- Rodar no Supabase → SQL Editor → New query → colar tudo → Run.
--
-- Seguro: tudo idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT)
-- e envolvido numa transação — se qualquer passo falhar, faz ROLLBACK inteiro.
-- Pode rodar mais de uma vez sem efeito colateral.
-- ============================================================================

BEGIN;

-- ============================================================
-- 035_ai_sellers — vendedores avaliados pela IA + pgvector
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.sellers (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  funcao          text NOT NULL DEFAULT 'closer',
  linked_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  observacoes     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sellers_account_idx ON public.sellers(account_id);
ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read sellers" ON public.sellers;
CREATE POLICY "members read sellers" ON public.sellers
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "agents write sellers" ON public.sellers;
CREATE POLICY "agents write sellers" ON public.sellers
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

-- ============================================================
-- 036_ai_documents_analyses — insumos + análises + bucket
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_documents (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  tipo            text NOT NULL,
  origem          text,
  storage_path    text,
  status          text NOT NULL DEFAULT 'recebido',
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  retencao_ate    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_documents_account_idx ON public.ai_documents(account_id);
ALTER TABLE public.ai_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read ai_documents" ON public.ai_documents;
CREATE POLICY "members read ai_documents" ON public.ai_documents
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "agents write ai_documents" ON public.ai_documents;
CREATE POLICY "agents write ai_documents" ON public.ai_documents
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS public.ai_analyses (
  id                    uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id            uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  document_id           uuid REFERENCES public.ai_documents(id) ON DELETE SET NULL,
  seller_id             uuid REFERENCES public.sellers(id) ON DELETE SET NULL,
  conversation_id       uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  tipo                  text NOT NULL,
  dimensoes             jsonb NOT NULL,
  nota                  text,
  perda_estimada_reais  numeric,
  perda_memoria_calculo text,
  prescricoes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  disposicao            text NOT NULL DEFAULT 'pendente',
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_analyses_account_idx ON public.ai_analyses(account_id);
CREATE INDEX IF NOT EXISTS ai_analyses_seller_idx ON public.ai_analyses(seller_id);
ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read ai_analyses" ON public.ai_analyses;
CREATE POLICY "members read ai_analyses" ON public.ai_analyses
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "agents write ai_analyses" ON public.ai_analyses;
CREATE POLICY "agents write ai_analyses" ON public.ai_analyses
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-insumos', 'ai-insumos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ai-insumos members read" ON storage.objects;
CREATE POLICY "ai-insumos members read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'ai-insumos'
    AND public.is_account_member(((storage.foldername(name))[1])::uuid)
  );
DROP POLICY IF EXISTS "ai-insumos agents write" ON storage.objects;
CREATE POLICY "ai-insumos agents write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'ai-insumos'
    AND public.is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );
DROP POLICY IF EXISTS "ai-insumos agents delete" ON storage.objects;
CREATE POLICY "ai-insumos agents delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'ai-insumos'
    AND public.is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

-- ============================================================
-- 037_ai_cria — scripts, objeções (embedding) e campanhas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_scripts (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  tipo        text NOT NULL DEFAULT 'comercial',
  titulo      text,
  etapas      jsonb NOT NULL DEFAULT '[]'::jsonb,
  versoes     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_scripts_account_idx ON public.ai_scripts(account_id);
ALTER TABLE public.ai_scripts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read ai_scripts" ON public.ai_scripts;
CREATE POLICY "members read ai_scripts" ON public.ai_scripts
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "agents write ai_scripts" ON public.ai_scripts;
CREATE POLICY "agents write ai_scripts" ON public.ai_scripts
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS public.ai_objections (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  origem        text NOT NULL DEFAULT 'texto',
  objecao       text NOT NULL,
  contornos     jsonb NOT NULL DEFAULT '[]'::jsonb,
  embedding     extensions.vector(1536),
  respondida_por uuid REFERENCES public.ai_analyses(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_objections_account_idx ON public.ai_objections(account_id);
CREATE INDEX IF NOT EXISTS ai_objections_embedding_idx
  ON public.ai_objections USING hnsw (embedding extensions.vector_cosine_ops);
ALTER TABLE public.ai_objections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read ai_objections" ON public.ai_objections;
CREATE POLICY "members read ai_objections" ON public.ai_objections
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "agents write ai_objections" ON public.ai_objections;
CREATE POLICY "agents write ai_objections" ON public.ai_objections
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS public.ai_campaigns (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  tipo        text NOT NULL DEFAULT 'oferta',
  titulo      text,
  mecanica    jsonb NOT NULL DEFAULT '{}'::jsonb,
  copy        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_campaigns_account_idx ON public.ai_campaigns(account_id);
ALTER TABLE public.ai_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read ai_campaigns" ON public.ai_campaigns;
CREATE POLICY "members read ai_campaigns" ON public.ai_campaigns
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "agents write ai_campaigns" ON public.ai_campaigns;
CREATE POLICY "agents write ai_campaigns" ON public.ai_campaigns
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

-- ============================================================
-- 038_ai_pdis — parecer + PDI (90 dias) por vendedor
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_pdis (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  seller_id     uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  parecer_texto text,
  plano_90d     jsonb NOT NULL DEFAULT '{}'::jsonb,
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
DROP POLICY IF EXISTS "agents write ai_pdis" ON public.ai_pdis;
CREATE POLICY "agents write ai_pdis" ON public.ai_pdis
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

-- ============================================================
-- 039_account_sales_config — método de vendas por conta (+seed/backfill)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.account_sales_config (
  account_id    uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  metodo_nome   text NOT NULL DEFAULT '3R',
  tom_de_voz    text,
  icp           jsonb,
  produto       jsonb,
  oferta        jsonb,
  dimensoes     jsonb,
  rubricas      jsonb,
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

INSERT INTO public.account_sales_config (account_id, moeda)
SELECT a.id, COALESCE(a.default_currency, 'BRL')
FROM public.accounts a
ON CONFLICT (account_id) DO NOTHING;

-- ============================================================
-- 040_ai_usage — telemetria de custo + contadores de quota
-- ============================================================
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
DROP POLICY IF EXISTS "admins read ai_usage_events" ON public.ai_usage_events;
CREATE POLICY "admins read ai_usage_events" ON public.ai_usage_events
  FOR SELECT USING (public.is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS public.usage_counters (
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  periodo     text NOT NULL,
  unidade     text NOT NULL,
  contador    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, periodo, unidade)
);
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read usage_counters" ON public.usage_counters;
CREATE POLICY "members read usage_counters" ON public.usage_counters
  FOR SELECT USING (public.is_account_member(account_id));

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

-- ============================================================
-- 041_billing — planos/assinatura (Stripe)
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
  plan                   text NOT NULL DEFAULT 'free',
  status                 text NOT NULL DEFAULT 'active',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_account_idx ON public.subscriptions(account_id);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read subscriptions" ON public.subscriptions;
CREATE POLICY "members read subscriptions" ON public.subscriptions
  FOR SELECT USING (public.is_account_member(account_id));

-- ============================================================
-- 042_usage_counter_delta — sobrecarga da RPC com p_delta (créditos)
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

-- ============================================================
-- PÓS-MIGRAÇÃO — contas internas em 'enterprise' (ilimitado),
-- pra a enforcement de assentos não limitar suas próprias marcas.
-- AUGRA / Elas que Vendem / Sales 3R.
-- ============================================================
UPDATE public.accounts SET plan = 'enterprise'
WHERE id IN (
  '9a526367-cc65-4cbd-b8e0-aeed02ebc9a4',  -- AUGRA
  '9139c2d5-42ef-4e78-9041-92a385056107',  -- Elas que Vendem
  'fd9b374f-e140-4bd4-8200-f8663fb09705'   -- Sales 3R
);

COMMIT;

-- ============================================================
-- CONFERÊNCIA (rodar depois, fora da transação):
--   select id, name, plan from public.accounts order by name;
--   select to_regclass('public.subscriptions'), to_regclass('public.usage_counters');
-- ============================================================
