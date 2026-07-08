-- ============================================================
-- 051_call_recordings.sql — gravação de ligação WhatsApp
--
-- O softphone grava o áudio da chamada (mic do SDR + o lead) no navegador
-- e sobe o .webm pro bucket privado `call-recordings`. Caminho:
-- {account_id}/{call_id}.webm — a 1ª pasta é o tenant, usada pela RLS.
-- ============================================================

ALTER TABLE public.whatsapp_calls
  ADD COLUMN IF NOT EXISTS recording_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "members read call recordings" ON storage.objects;
CREATE POLICY "members read call recordings" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'call-recordings'
    AND public.is_account_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "agents upload call recordings" ON storage.objects;
CREATE POLICY "agents upload call recordings" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'call-recordings'
    AND public.is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "agents update call recordings" ON storage.objects;
CREATE POLICY "agents update call recordings" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'call-recordings'
    AND public.is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );
