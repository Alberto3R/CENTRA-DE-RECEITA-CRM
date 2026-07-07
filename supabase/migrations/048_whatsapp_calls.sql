-- ============================================================
-- 048_whatsapp_calls.sql — módulo de ligação WhatsApp (Calling API)
--
-- Registro/estado de cada chamada VoIP feita pelo número do CRM via
-- WhatsApp Business Calling API. Serve dois propósitos:
--   1) LOG: histórico de ligações por contato/negócio (e alimenta o
--      auto-log de atividade 'call' do Painel Outbound).
--   2) SINALIZAÇÃO: o webhook grava o `answer_sdp` e o `status` aqui; o
--      softphone no navegador do SDR escuta via Supabase Realtime e
--      aplica o SDP à sua stack WebRTC. Por isso a tabela entra na
--      publication `supabase_realtime`.
--
-- Mídia (áudio) é ponta-a-ponta WebRTC navegador<->WhatsApp; NUNCA passa
-- pelo banco. Só o SDP de sinalização e o estado trafegam por aqui.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_calls (
  id           uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  deal_id      uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- SDR que ligou

  wa_call_id   text,                       -- id da chamada na Meta (wacid...)
  direction    text NOT NULL DEFAULT 'BUSINESS_INITIATED', -- BUSINESS_INITIATED | USER_INITIATED
  -- ciclo de vida local: initiating -> connecting -> ringing -> in_progress
  --                       -> completed | failed | rejected | missed
  status       text NOT NULL DEFAULT 'initiating',
  to_phone     text,

  -- sinalização (relay via Realtime): SDP answer que a Meta devolve no
  -- webhook de connect. O offer do SDR não precisa ser persistido.
  answer_sdp   text,

  error_code   integer,
  error_message text,
  biz_opaque_callback_data text,

  start_time   timestamptz,               -- quando atendida
  end_time     timestamptz,
  duration_seconds integer,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_calls_account_idx
  ON public.whatsapp_calls(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_calls_wacid_idx
  ON public.whatsapp_calls(wa_call_id);
CREATE INDEX IF NOT EXISTS whatsapp_calls_contact_idx
  ON public.whatsapp_calls(contact_id);

ALTER TABLE public.whatsapp_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read whatsapp_calls" ON public.whatsapp_calls;
CREATE POLICY "members read whatsapp_calls" ON public.whatsapp_calls
  FOR SELECT USING (public.is_account_member(account_id));

-- Agentes (SDR+) criam/atualizam suas chamadas. O webhook usa service_role
-- e ignora RLS; esta policy cobre o initiate/terminate feito pelo app.
DROP POLICY IF EXISTS "agents write whatsapp_calls" ON public.whatsapp_calls;
CREATE POLICY "agents write whatsapp_calls" ON public.whatsapp_calls
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

-- Realtime: o softphone escuta UPDATEs desta tabela para receber o
-- answer_sdp e as transições de status em tempo real.
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_calls;
