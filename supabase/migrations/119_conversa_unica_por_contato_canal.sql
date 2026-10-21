-- 119 · Uma conversa por (conta, contato, canal).
--
-- O problema
--
--   O webhook do WhatsApp buscava a conversa do contato com `.single()`, que
--   erra com 0 OU 2+ linhas, e tratava o erro como "não existe". `conversations`
--   não tinha nenhuma trava de unicidade (só `contacts` tem, migração 022).
--   Quando duas mensagens do mesmo contato chegavam quase juntas, as duas
--   entregas viam 0 conversas e criavam uma cada. Dali em diante a busca via
--   sempre 2+, errava, e TODA mensagem nova abria outra conversa. Como
--   `ai_handoff` é por conversa, cada uma nascia com o agente de
--   pré-atendimento ligado e ele respondia por cima do humano.
--
--   Caso real (21/out/2026): um lead escreveu "Bom dia" e "Tudo bem?" com 2 s
--   de diferença; 20 conversas depois ele tinha recebido 33 respostas do agente
--   repetindo a mesma pergunta, mesmo após pedir atendimento humano.
--
-- O conserto de código (mesmo PR) faz a busca aceitar várias linhas e reler a
-- conversa quando perde a corrida. Esta migração limpa o que já existe e
-- impede que a primeira duplicata volte a nascer.
--
-- ⚠️ Aplicar DEPOIS do deploy do código deste PR. O código antigo não relê a
--    conversa quando o insert esbarra no índice do passo 6: a mensagem de quem
--    perde a corrida seria descartada.
--
-- Em ordem
--
--   1. guarda em `_bkp_conversas_dup_119` tudo o que vai mexer (conversas,
--      avaliações e o mapa id → conversa antiga das linhas movidas);
--   2. em cada grupo (conta, contato, canal) com 2+ conversas, a sobrevivente é a
--      de atividade mais recente (desempate: a mais antiga, depois o id);
--   3. move para ela as linhas das 9 tabelas que referenciam `conversations`
--      (nada é perdido: mensagens, turnos do agente, negócios, reações...);
--   4. consolida na sobrevivente: `ai_handoff` (basta uma ter) e `unread_count`
--      (soma). Responsável (`assigned_agent_id`) não é tocado — nenhuma das
--      duplicatas existentes tinha, e mexer nele dispara a automação de
--      atribuição;
--   5. apaga as duplicatas, já vazias. A avaliação do agente é uma por conversa
--      (PK em conversation_id): a da sobrevivente fica, as das duplicatas vão
--      para o backup e o avaliador gera de novo sobre a conversa inteira;
--   6. cria o índice único parcial (`channel_id` nulo = conversa legada, sem
--      canal, fica de fora).
--
-- Idempotente: sem duplicatas, os passos 1–5 não fazem nada.
-- Reversão: `_bkp_conversas_dup_119` tem as linhas das conversas apagadas e o
-- mapa de quem estava em qual conversa.

-- 1) Backup (RLS ligado e sem policy: inalcançável pela API, só por SQL).
CREATE TABLE IF NOT EXISTS public._bkp_conversas_dup_119 (
  id        bigserial PRIMARY KEY,
  tipo      text        NOT NULL,
  payload   jsonb       NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._bkp_conversas_dup_119 ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_tab text;
BEGIN
  -- 2) Grupos duplicados e quem sobrevive em cada um.
  CREATE TEMP TABLE _conv_membros ON COMMIT DROP AS
  SELECT *
    FROM (
      SELECT c.id,
             c.ai_handoff,
             c.unread_count,
             first_value(c.id) OVER w AS canon_id,
             count(*)          OVER (PARTITION BY c.account_id, c.contact_id, c.channel_id) AS n
        FROM public.conversations c
       WHERE c.channel_id IS NOT NULL
      WINDOW w AS (
        PARTITION BY c.account_id, c.contact_id, c.channel_id
        ORDER BY c.last_message_at DESC NULLS LAST, c.created_at, c.id
      )
    ) g
   WHERE g.n > 1;

  -- 1) Backup, antes de qualquer alteração.
  INSERT INTO public._bkp_conversas_dup_119 (tipo, payload)
  SELECT 'conversations', coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    FROM public.conversations c
    JOIN _conv_membros m ON m.id = c.id;

  INSERT INTO public._bkp_conversas_dup_119 (tipo, payload)
  SELECT 'ai_agente_avaliacoes', coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    FROM public.ai_agente_avaliacoes a
    JOIN _conv_membros m ON m.id = a.conversation_id;

  -- 3) Move as linhas das duplicatas para a sobrevivente (com o mapa no backup).
  FOREACH v_tab IN ARRAY ARRAY[
    'messages', 'ai_agente_turnos', 'deals', 'message_reactions', 'flow_runs',
    'ai_analyses', 'ai_documents', 'scheduled_calls', 'scheduled_messages'
  ] LOOP
    EXECUTE format($f$
      INSERT INTO public._bkp_conversas_dup_119 (tipo, payload)
      SELECT %L,
             coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'conversation_id', t.conversation_id)), '[]'::jsonb)
        FROM public.%I t
        JOIN _conv_membros m ON m.id = t.conversation_id AND m.id <> m.canon_id
    $f$, v_tab || '_map', v_tab);

    EXECUTE format($f$
      UPDATE public.%I t
         SET conversation_id = m.canon_id
        FROM _conv_membros m
       WHERE t.conversation_id = m.id AND m.id <> m.canon_id
    $f$, v_tab);
  END LOOP;

  -- 4) Consolida na sobrevivente.
  UPDATE public.conversations c
     SET ai_handoff   = c.ai_handoff OR g.handoff,
         unread_count = g.unread
    FROM (
      SELECT canon_id,
             bool_or(ai_handoff)               AS handoff,
             coalesce(sum(unread_count), 0)::int AS unread
        FROM _conv_membros
       GROUP BY canon_id
    ) g
   WHERE c.id = g.canon_id;

  -- 5) Apaga as duplicatas (já vazias; a avaliação delas cai em cascata).
  DELETE FROM public.conversations
   WHERE id IN (SELECT id FROM _conv_membros WHERE id <> canon_id);
  -- FIM-DO-MERGE
END $$;

-- 6) A trava: duas entregas simultâneas já não conseguem criar duas conversas.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_conta_contato_canal_uq
  ON public.conversations (account_id, contact_id, channel_id)
  WHERE channel_id IS NOT NULL;
