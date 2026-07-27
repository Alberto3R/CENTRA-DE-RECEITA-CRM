-- ============================================================
-- 076_telnyx_calls_recording_path.sql
--
-- Gravação client-side da ligação PSTN (Telnyx): o softphone grava mic+lead
-- no navegador e sobe pro Storage (bucket 'call-recordings', mesmo do
-- WhatsApp). `recording_path` guarda o caminho no Storage; a tela de Ligações
-- gera signed URL pra tocar e a análise do Gestor transcreve por aqui.
-- ============================================================

ALTER TABLE public.telnyx_calls ADD COLUMN IF NOT EXISTS recording_path text;
