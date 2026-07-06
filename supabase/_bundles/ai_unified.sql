-- ===== 035_ai_sellers.sql =====
-- ============================================================
-- 035_ai_sellers.sql — fundação do domínio de IA de gestão comercial
--
-- Parte da fusão head comercIAl → WACRM (produto SaaS único). Habilita o
-- pgvector (usado por ai_objections na 037) e cria `sellers`: os VENDEDORES
-- avaliados pela IA (closer/sdr/social_seller/gestor). São distintos de
-- `contacts` (leads externos) e de `profiles` (usuários-login do CRM) — por
-- isso tabela própria. `linked_user_id` liga a um login quando o vendedor também
-- usa o sistema (opcional).
--
-- RLS: padrão da casa (is_account_member) — ver 028_ai_agent.sql.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.sellers (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  -- gestor | closer | sdr | social_seller
  funcao          text NOT NULL DEFAULT 'closer',
  -- Liga a um usuário-login do CRM quando o vendedor também é membro da conta.
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

-- ===== 036_ai_documents_analyses.sql =====
-- ============================================================
-- 036_ai_documents_analyses.sql — núcleo ANALISA
--
-- `ai_documents`: insumo bruto de análise (transcrição colada/upload, ou a
--   referência a uma `conversation` do CRM). Renomeado de `documents` (HEAD)
--   para deixar explícito que é insumo de IA, não anexo de chat.
-- `ai_analyses`: saída estruturada das dimensões (evidência → perda → prescrição).
--   Vincula opcionalmente a um `seller` e a uma `conversation`.
--
-- Storage: bucket privado `ai-insumos` com path <account_id>/... e policy
-- espelhada (isolamento por conta).
-- ============================================================

-- ---------- ai_documents ----------
CREATE TABLE IF NOT EXISTS public.ai_documents (
  id              uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- call_transcript | whatsapp_txt | whatsapp_print | roleplay
  tipo            text NOT NULL,
  origem          text,
  storage_path    text,
  -- recebido | validado | rejeitado | processado
  status          text NOT NULL DEFAULT 'recebido',
  -- quando o insumo vem de uma conversa do próprio CRM
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  -- política de retenção (LGPD): job de limpeza deleta após esta data
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

-- ---------- ai_analyses ----------
CREATE TABLE IF NOT EXISTS public.ai_analyses (
  id                    uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id            uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  document_id           uuid REFERENCES public.ai_documents(id) ON DELETE SET NULL,
  seller_id             uuid REFERENCES public.sellers(id) ON DELETE SET NULL,
  conversation_id       uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  -- call | whatsapp | roleplay
  tipo                  text NOT NULL,
  dimensoes             jsonb NOT NULL,
  nota                  text,
  perda_estimada_reais  numeric,
  perda_memoria_calculo text,
  -- pacote acionável + snapshot do método (prescricoes, proximos_passos,
  -- dados_faltantes, dados_crm, prompt_versao, metodo, customizado)
  prescricoes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- pendente | usei | editei | descartei
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

-- ---------- Storage: bucket privado de insumos ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-insumos', 'ai-insumos', false)
ON CONFLICT (id) DO NOTHING;

-- Policies de Storage espelham o isolamento por conta: o primeiro segmento do
-- path (<account_id>/...) tem de ser uma conta da qual o usuário é membro.
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

-- ===== 037_ai_cria.sql =====
-- ============================================================
-- 037_ai_cria.sql — motor CRIA (scripts, objeções, campanhas)
--
-- `ai_scripts`: scripts comerciais gerados (9 etapas).
-- `ai_objections`: objeções mapeadas + contornos, com embedding (pgvector) para
--   sugerir objeções similares já tratadas (busca semântica).
-- `ai_campaigns`: rascunhos de campanha gerados por IA (gamificação/oferta/edu).
--   Distinto de `broadcasts`/`automations` do CRM — é conteúdo gerado, não envio.
-- ============================================================

-- ---------- ai_scripts ----------
CREATE TABLE IF NOT EXISTS public.ai_scripts (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- comercial | followup | ...
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

-- ---------- ai_objections ----------
CREATE TABLE IF NOT EXISTS public.ai_objections (
  id            uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- print | texto | analysis
  origem        text NOT NULL DEFAULT 'texto',
  objecao       text NOT NULL,
  contornos     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- embedding para busca de objeções similares (text-embedding ~1536 dims)
  embedding     extensions.vector(1536),
  respondida_por uuid REFERENCES public.ai_analyses(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_objections_account_idx ON public.ai_objections(account_id);
-- Índice de similaridade (HNSW, cosine). Criado só quando há linhas; aqui fica a
-- definição — o planner usa quando útil.
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

-- ---------- ai_campaigns ----------
CREATE TABLE IF NOT EXISTS public.ai_campaigns (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- gamificacao | oferta | educacional
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

-- ===== 038_ai_pdis.sql =====
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

-- ===== 039_account_sales_config.sql =====
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

-- ===== 040_ai_usage.sql =====
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

-- ===== 041_billing.sql =====
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

