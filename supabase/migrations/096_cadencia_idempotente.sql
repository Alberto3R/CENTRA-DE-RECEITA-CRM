-- ============================================================
-- 096_cadencia_idempotente.sql — o banco passa a ser o dono do estado da régua
--
-- INCIDENTE (02→08/set/2026): a `diag-cadencia` não guardava em lugar nenhum
-- quantos toques cada lead já tinha levado. Ela DEDUZIA isso lendo o nome de
-- todos os disparos já criados e cruzando com os destinatários num
-- `.in(<milhares de ids>)`. Quando essa lista passou do que o PostgREST aceita
-- numa URL, a consulta passou a falhar; o helper de paginação engolia o erro e
-- devolvia lista vazia; todo lead virava "nunca recebeu nada" e levava a
-- abertura de novo — de hora em hora, 11× por dia. 3.694 envios para 131
-- pessoas, algumas 76 vezes. E o loop se alimentava: cada envio criava mais um
-- disparo, que aumentava a lista que quebrava a consulta.
--
-- A correção estrutural não é "consertar a contagem": é tirar o estado da
-- dedução e colocá-lo numa linha com UNIQUE. Mesmo que a régua enlouqueça de
-- novo, o banco só libera um toque por (contato, cadência, número do toque).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.outbound_touches (
  id             uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id     uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Qual régua. Hoje só 'diagnostico', mas a tabela não é do Diagnóstico.
  cadencia       text NOT NULL,
  -- Número do toque dentro da régua (1 = abertura).
  toque          integer NOT NULL,
  template_name  text,
  broadcast_id   uuid REFERENCES public.broadcasts(id) ON DELETE SET NULL,
  -- enfileirado → entregue | falhou (o trigger lá embaixo fecha o ciclo)
  status         text NOT NULL DEFAULT 'enfileirado',
  tentativas     integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, contact_id, cadencia, toque)
);

CREATE INDEX IF NOT EXISTS outbound_touches_contato_idx
  ON public.outbound_touches(account_id, cadencia, contact_id, toque DESC);
CREATE INDEX IF NOT EXISTS outbound_touches_broadcast_idx
  ON public.outbound_touches(broadcast_id) WHERE broadcast_id IS NOT NULL;

ALTER TABLE public.outbound_touches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read outbound_touches" ON public.outbound_touches;
CREATE POLICY "members read outbound_touches" ON public.outbound_touches
  FOR SELECT USING (public.is_account_member(account_id));
-- Escrita é só de máquina (service role, que ignora RLS). Ninguém edita toque
-- entregue pela UI.

-- ------------------------------------------------------------
-- reservar_toque — a trava. Devolve true UMA vez por toque.
--
-- Retentativa existe porque entrega falha por motivo real (número sem
-- WhatsApp, janela fechada) e a régua precisa poder insistir — mas insiste na
-- MESMA linha, com teto e intervalo. Não há caminho em que a mesma pessoa
-- receba o mesmo toque duas vezes por erro de leitura.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservar_toque(
  p_account        uuid,
  p_contact        uuid,
  p_cadencia       text,
  p_toque          integer,
  p_template       text DEFAULT NULL,
  p_max_tentativas integer DEFAULT 3,
  p_espera         interval DEFAULT '6 hours'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.outbound_touches
    (account_id, contact_id, cadencia, toque, template_name)
  VALUES (p_account, p_contact, p_cadencia, p_toque, p_template)
  ON CONFLICT (account_id, contact_id, cadencia, toque) DO UPDATE
    SET tentativas    = public.outbound_touches.tentativas + 1,
        template_name = COALESCE(EXCLUDED.template_name, public.outbound_touches.template_name),
        status        = 'enfileirado',
        updated_at    = now()
    WHERE public.outbound_touches.status = 'falhou'
      AND public.outbound_touches.tentativas < p_max_tentativas
      AND public.outbound_touches.updated_at < now() - p_espera
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;
END;
$$;

-- Liga o disparo criado ao toque reservado (a régua chama logo após enfileirar).
CREATE OR REPLACE FUNCTION public.vincular_broadcast_ao_toque(
  p_account   uuid,
  p_contact   uuid,
  p_cadencia  text,
  p_toque     integer,
  p_broadcast uuid
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.outbound_touches
     SET broadcast_id = p_broadcast, updated_at = now()
   WHERE account_id = p_account AND contact_id = p_contact
     AND cadencia = p_cadencia AND toque = p_toque;
$$;

-- ------------------------------------------------------------
-- Fecha o ciclo: o resultado da entrega volta para o toque sozinho, sem a
-- régua precisar ficar sabendo. É isso que permite a retentativa acima.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_status_toque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.outbound_touches
       SET status = CASE
                      WHEN NEW.status IN ('sent','delivered','read','replied') THEN 'entregue'
                      WHEN NEW.status = 'failed' THEN 'falhou'
                      ELSE status
                    END,
           updated_at = now()
     WHERE broadcast_id = NEW.broadcast_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_status_toque ON public.broadcast_recipients;
CREATE TRIGGER trg_sincronizar_status_toque
  AFTER UPDATE OF status ON public.broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_status_toque();

-- ------------------------------------------------------------
-- 'skipped': destinatário que o motor recusou por trava anti-repetição. Não é
-- 'failed' — falha faz régua reenviar e suja a métrica de entrega.
-- ------------------------------------------------------------
ALTER TABLE public.broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
ALTER TABLE public.broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status = ANY (ARRAY['pending','sent','delivered','read','replied','failed','skipped']));

-- Disparo inteiro barrado pela trava também precisa de nome próprio.
ALTER TABLE public.broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE public.broadcasts
  ADD CONSTRAINT broadcasts_status_check
  CHECK (status = ANY (ARRAY['draft','scheduled','sending','sent','failed','skipped']));

-- A trava do motor pergunta "esse contato já recebeu esse template nas últimas
-- 24h?" a cada lote. Sem este índice a pergunta fica cara conforme a base cresce.
CREATE INDEX IF NOT EXISTS broadcast_recipients_contato_recente_idx
  ON public.broadcast_recipients(contact_id, sent_at DESC)
  WHERE status IN ('sent','delivered','read','replied');

-- ------------------------------------------------------------
-- Disparo de máquina ≠ disparo de gente. Sem esta marca, a tela de Disparos da
-- Sales 3R mostra 4.094 envelopes de automação e 3 disparos de verdade.
-- ------------------------------------------------------------
ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';

UPDATE public.broadcasts
   SET kind = 'system'
 WHERE kind <> 'system'
   AND (name LIKE 'Diag %' OR name LIKE 'Aviso SDR %' OR name LIKE 'CCC %');

CREATE INDEX IF NOT EXISTS broadcasts_kind_idx
  ON public.broadcasts(account_id, kind, created_at DESC);
