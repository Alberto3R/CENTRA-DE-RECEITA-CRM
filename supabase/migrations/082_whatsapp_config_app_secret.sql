-- App Secret do App Meta dono da WABA, por canal (criptografado GCM, igual ao
-- access_token). Usado para validar a assinatura HMAC dos webhooks POR CANAL;
-- o env META_APP_SECRET vira apenas fallback. Elimina a necessidade de
-- env + redeploy a cada cliente novo (onboarding self-service pela UI).
-- Já aplicada em produção via MCP; versionada aqui para rastreabilidade.
alter table public.whatsapp_config add column if not exists app_secret text;
comment on column public.whatsapp_config.app_secret is
  'App Secret (criptografado GCM) do App Meta dono da WABA. Valida a assinatura dos webhooks por canal; fallback = env META_APP_SECRET.';
