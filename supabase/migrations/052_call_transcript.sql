-- ============================================================
-- 052_call_transcript.sql — transcrição da ligação
--
-- Guarda a transcrição (texto) da gravação da chamada, para reuso e para
-- alimentar a análise do Gestor Comercial (/api/ai/analise-call).
-- ============================================================

ALTER TABLE public.whatsapp_calls
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcribed_at timestamptz;
