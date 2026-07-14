-- CORREÇÃO DE SEGURANÇA — Security Advisor: rls_disabled_in_public (nível ERROR).
--
-- public.app_config guarda o segredo do cron do disparo (broadcast_cron_secret)
-- e estava com RLS DESLIGADO → qualquer um com a chave anônima (que é pública,
-- vai no bundle do front) podia ler/editar/apagar. Habilitar RLS SEM policy nega
-- todo acesso de anon/authenticated.
--
-- Os dois leitores legítimos IGNORAM RLS (verificado: rolbypassrls = true):
--   - o cron (pg_cron roda como `postgres`) lê o segredo pra montar o header;
--   - o endpoint /broadcast/process lê via service role (supabaseAdmin).
-- Nenhum código cliente lê app_config. Portanto a mudança é segura.
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config FORCE ROW LEVEL SECURITY;
