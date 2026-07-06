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
