-- ============================================================
-- 085_quick_replies.sql — respostas rápidas do atendente
--
-- Atalhos de texto acionados por "/" no compositor do inbox. O CTA
-- "Digite '/' para respostas rápidas" já existia na UI desde sempre,
-- mas não havia nem tabela nem tela — era texto morto.
--
-- NÃO confundir com public.message_templates: aquilo é HSM da Meta
-- (precisa de aprovação, tem categoria/idioma/componentes e serve para
-- reabrir a janela de 24h). Isto aqui é texto livre, interno, sem
-- qualquer ida à Meta — só poupa digitação no meio da conversa.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quick_replies (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  shortcut    text NOT NULL,
  content     text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quick_replies_account_idx
  ON public.quick_replies(account_id, position);

-- O atalho é o que o atendente digita depois da barra: precisa ser único
-- por conta e case-insensitive (/orcamento e /Orcamento são o mesmo).
CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_account_shortcut_key
  ON public.quick_replies(account_id, lower(shortcut));

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer membro — o atendente precisa usar no inbox.
-- Escrita só admin+, mesmo padrão de loss_reasons (046).
DROP POLICY IF EXISTS "members read quick_replies" ON public.quick_replies;
CREATE POLICY "members read quick_replies" ON public.quick_replies
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "admins write quick_replies" ON public.quick_replies;
CREATE POLICY "admins write quick_replies" ON public.quick_replies
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS quick_replies_updated_at ON public.quick_replies;
CREATE TRIGGER quick_replies_updated_at
  BEFORE UPDATE ON public.quick_replies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
