-- Broadcasts of a template with an IMAGE/VIDEO/DOCUMENT header must send
-- the media on every single message. Until now the wizard collected that
-- media URL but never stored it: only the client-side send path had it in
-- memory. The server-side worker (scheduled sends, resumes, takeovers)
-- had to fall back to message_templates.header_media_url — which is NULL
-- for any template created in Meta's own editor and synced back, since
-- those only carry a creation-time handle.
--
-- Result: scheduled broadcasts of media-header templates failed, and
-- client-side ones could be sent with a Meta handle URL that Meta accepts
-- and never delivers. Persisting the chosen media makes both paths agree.
alter table public.broadcasts
  add column if not exists header_media_url text;

comment on column public.broadcasts.header_media_url is
  'Media URL sent with every message of a media-header template. Must be publicly fetchable by Meta on each send — never a Meta upload handle (scontent.whatsapp.net/lookaside), which is accepted at send time and silently never delivered.';
