-- ============================================================
-- 075_telnyx_calls.sql — módulo de ligação PSTN (Telnyx / discador WebRTC)
--
-- Ligação DIRETA ao telefone do lead (PSTN) via Telnyx, separada da
-- ligação VoIP do WhatsApp (whatsapp_calls, migration 048).
--
-- Arquitetura (Modelo A): o SDR fala pelo SOFTPHONE WebRTC no navegador
-- (@telnyx/webrtc, autenticado por JWT curto do backend). A mídia é
-- ponta-a-ponta browser<->Telnyx; NUNCA passa pelo banco. Esta tabela é
-- só LOG + estado:
--   1) histórico de ligações por contato/negócio (alimenta o auto-log de
--      atividade 'call' do Painel Outbound, igual whatsapp_calls);
--   2) o webhook /api/telnyx/webhook grava status e URL da gravação; o
--      histórico/softphone escutam via Realtime.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telnyx_calls (
  id           uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  deal_id      uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- SDR que ligou

  -- identificadores da Telnyx Call Control API
  call_control_id text,
  call_leg_id     text,
  call_session_id text,

  direction    text NOT NULL DEFAULT 'outbound', -- outbound | inbound
  -- ciclo de vida: initiating -> ringing -> answered -> completed
  --                            | failed | busy | no_answer | canceled
  status       text NOT NULL DEFAULT 'initiating',
  from_phone   text,   -- caller id apresentado (nosso número Telnyx)
  to_phone     text,   -- número do lead

  hangup_cause  text,
  recording_id  text,
  recording_url text,   -- gravação (webhook call.recording.saved) — player no CRM
  transcript    text,   -- transcrição sob demanda (reaproveita ElevenLabs Scribe)

  start_time   timestamptz,               -- quando atendida
  end_time     timestamptz,
  duration_seconds integer,

  error_code    text,
  error_message text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telnyx_calls_account_idx
  ON public.telnyx_calls(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS telnyx_calls_control_idx
  ON public.telnyx_calls(call_control_id);
CREATE INDEX IF NOT EXISTS telnyx_calls_session_idx
  ON public.telnyx_calls(call_session_id);
CREATE INDEX IF NOT EXISTS telnyx_calls_contact_idx
  ON public.telnyx_calls(contact_id);

ALTER TABLE public.telnyx_calls ENABLE ROW LEVEL SECURITY;

-- Membros da conta leem o histórico das ligações da própria conta.
DROP POLICY IF EXISTS "members read telnyx_calls" ON public.telnyx_calls;
CREATE POLICY "members read telnyx_calls" ON public.telnyx_calls
  FOR SELECT USING (public.is_account_member(account_id));

-- Agentes (SDR+) criam/atualizam suas chamadas. O webhook usa service_role
-- e ignora RLS; esta policy cobre o initiate/hangup feito pelo app.
DROP POLICY IF EXISTS "agents write telnyx_calls" ON public.telnyx_calls;
CREATE POLICY "agents write telnyx_calls" ON public.telnyx_calls
  FOR ALL USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

-- Realtime: histórico e softphone escutam status + gravação em tempo real.
ALTER PUBLICATION supabase_realtime ADD TABLE public.telnyx_calls;
