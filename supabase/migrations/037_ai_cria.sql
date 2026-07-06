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
