-- ============================================================
-- 123_api_leitura_indices.sql — índices da API pública de leitura
--
-- Os endereços GET /api/v1/{contacts,deals,conversations,messages}
-- paginam em ordem (updated_at, id) — mensagens em (created_at, id) —
-- filtrando pela conta. Sem estes índices, cada página ordenaria a
-- tabela inteira da conta. Só cria índice: nada muda no dado.
-- ============================================================

CREATE INDEX IF NOT EXISTS contacts_account_updated_idx      ON public.contacts (account_id, updated_at, id);
CREATE INDEX IF NOT EXISTS deals_account_updated_idx         ON public.deals (account_id, updated_at, id);
CREATE INDEX IF NOT EXISTS conversations_account_updated_idx ON public.conversations (account_id, updated_at, id);
CREATE INDEX IF NOT EXISTS messages_created_idx              ON public.messages (created_at, id);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON public.messages (conversation_id, created_at, id);
