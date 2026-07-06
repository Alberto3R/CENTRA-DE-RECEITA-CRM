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
