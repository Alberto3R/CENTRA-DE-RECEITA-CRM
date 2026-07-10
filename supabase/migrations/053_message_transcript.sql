-- Cache de transcrição de mensagens de áudio (voz) do WhatsApp.
-- A análise de conversa (Gestor Comercial) usa isso para transcrever os
-- áudios uma única vez e reaproveitar em análises seguintes, evitando
-- re-hittar a ElevenLabs Scribe a cada análise.
alter table public.messages
  add column if not exists transcript text;

comment on column public.messages.transcript is
  'Transcrição de mensagem de áudio (voz) via ElevenLabs Scribe, cacheada para a análise de conversa. Null para mensagens não-áudio ou ainda não transcritas.';
