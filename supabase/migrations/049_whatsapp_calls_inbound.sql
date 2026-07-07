-- ============================================================
-- 049_whatsapp_calls_inbound.sql — atender chamadas entrantes
--
-- Chamada USER_INITIATED: o webhook de connect traz um SDP *offer* do
-- usuário. Guardamos aqui para o softphone do SDR gerar o answer e aceitar
-- (POST action=accept). Relay via Realtime (a tabela já está na publication).
-- ============================================================

ALTER TABLE public.whatsapp_calls
  ADD COLUMN IF NOT EXISTS offer_sdp text;
