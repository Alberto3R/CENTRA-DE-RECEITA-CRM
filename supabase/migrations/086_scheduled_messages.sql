-- ============================================================
-- 086_scheduled_messages.sql — mensagem agendada 1:1 na conversa
--
-- O vendedor combina com o lead "te chamo dia 20" e agenda o toque
-- direto da conversa. Um worker (migration 087) dispara no horário.
--
-- POR QUE SÓ TEMPLATE: o agendamento existe justamente para datas
-- futuras — dias ou semanas. Nessa altura a janela de 24h do WhatsApp
-- já fechou, e a Meta recusa texto livre com #131047. Só um HSM
-- aprovado reabre a conversa. Por isso não há coluna de texto livre
-- aqui: guardar um caminho que falharia em quase todo agendamento
-- seria convidar o erro.
--
-- `preview` guarda o corpo JÁ renderizado (variáveis substituídas).
-- Serve para a UI mostrar o que vai ser enviado e para o balão no
-- inbox depois do envio — messages.content_text é null em template,
-- então sem isto a bolha apareceria vazia.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Canal resolvido no envio a partir da conversa; guardado só para auditoria.
  channel_id        uuid REFERENCES public.whatsapp_config(id) ON DELETE SET NULL,
  template_name     text NOT NULL,
  template_language text NOT NULL DEFAULT 'pt_BR',
  -- Parâmetros posicionais do body ({{1}}, {{2}}...), na ordem.
  template_params   jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview           text NOT NULL,
  scheduled_at      timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sending','sent','failed','canceled')),
  attempts          integer NOT NULL DEFAULT 0,
  claimed_at        timestamptz,
  error             text,
  -- wamid devolvido pela Meta, para casar com a linha em messages.
  wa_message_id     text,
  sent_at           timestamptz,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Fila do worker: só o que está pendente importa.
CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx
  ON public.scheduled_messages(scheduled_at)
  WHERE status = 'pending';

-- Painel de pendentes dentro da conversa.
CREATE INDEX IF NOT EXISTS scheduled_messages_conversation_idx
  ON public.scheduled_messages(conversation_id, status, scheduled_at);

ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de deals (017): membro lê, agent+ escreve. Qualquer
-- vendedor da conta pode cancelar um agendamento do colega — cobertura
-- de férias/ausência é caso real e o histórico fica em created_by.
DROP POLICY IF EXISTS scheduled_messages_select ON public.scheduled_messages;
CREATE POLICY scheduled_messages_select ON public.scheduled_messages
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS scheduled_messages_insert ON public.scheduled_messages;
CREATE POLICY scheduled_messages_insert ON public.scheduled_messages
  FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS scheduled_messages_update ON public.scheduled_messages;
CREATE POLICY scheduled_messages_update ON public.scheduled_messages
  FOR UPDATE USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS scheduled_messages_delete ON public.scheduled_messages;
CREATE POLICY scheduled_messages_delete ON public.scheduled_messages
  FOR DELETE USING (public.is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS scheduled_messages_updated_at ON public.scheduled_messages;
CREATE TRIGGER scheduled_messages_updated_at
  BEFORE UPDATE ON public.scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Segredo do cron, no mesmo esquema do broadcast (055): mora no banco,
-- lido pelo pg_cron no header e pelo endpoint via service role.
INSERT INTO public.app_config (key, value)
VALUES ('scheduled_messages_cron_secret', encode(gen_random_bytes(24), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- Reserva atômica dos vencidos.
--
-- DIFERENÇA DELIBERADA para claim_broadcast_recipients: aqui NÃO há
-- recuperação de claim preso. No disparo em massa, reenviar depois de
-- 3 minutos é aceitável; num follow-up 1:1 uma duplicata chega como
-- desleixo na conversa do lead. Se o worker morrer no meio, a linha
-- fica em 'sending' e aparece travada na UI para decisão humana —
-- preferimos um envio parado e visível a um envio dobrado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_scheduled_messages(p_limit int)
RETURNS SETOF public.scheduled_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE scheduled_messages m
  SET status = 'sending',
      claimed_at = now(),
      attempts = m.attempts + 1
  WHERE m.id IN (
    SELECT id FROM scheduled_messages
    WHERE status = 'pending'
      AND scheduled_at <= now()
    ORDER BY scheduled_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING m.*;
END;
$$;

-- A função é SECURITY DEFINER: sem isto, qualquer um com a anon key
-- poderia virar agendamentos de QUALQUER conta para 'sending' e matar
-- a feature inteira. Note que `REVOKE ... FROM public` NÃO basta: os
-- grants para anon/authenticated vêm dos default privileges do
-- Supabase e são explícitos por papel, então precisam ser nomeados.
REVOKE EXECUTE ON FUNCTION public.claim_scheduled_messages(int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_messages(int) TO service_role;
