-- ============================================================
-- 088_gateway_tag_and_deal_mode.sql — controle do que o webhook faz
--
-- Três controles que faltavam na configuração do webhook:
--
--  1. default_tag_id — marca TODO lead que entra por este webhook.
--     Guardado por ID e não por nome de propósito: `tags` não tem unique
--     em (account_id, name), então casar por nome convive com duplicata
--     e o find-or-create por ilike pode escolher a errada.
--
--  2. deal_mode — o que fazer quando o lead já tem negócio aberto:
--       update_or_create (padrão) = comportamento atual;
--       update_only               = nunca abre negócio novo;
--       always_create             = sempre abre um novo.
--
--  3. keep_stage — quando já existe negócio, não mexe na etapa. Serve
--     para o caso "o lead já está no meu funil, só quero a tag" sem que
--     a integração empurre ele para frente por baixo do time.
--
-- Versiona também product_map e auto_route_by_name, que estavam em
-- produção sem migration (aplicadas via MCP em algum momento). Sem isto
-- um banco novo sobe sem elas e a rota quebra.
-- ============================================================

ALTER TABLE public.gateway_webhook_config
  ADD COLUMN IF NOT EXISTS product_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_route_by_name boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_tag_id uuid REFERENCES public.tags(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_mode text NOT NULL DEFAULT 'update_or_create',
  ADD COLUMN IF NOT EXISTS keep_stage boolean NOT NULL DEFAULT false;

ALTER TABLE public.gateway_webhook_config
  DROP CONSTRAINT IF EXISTS gateway_webhook_config_deal_mode_check;
ALTER TABLE public.gateway_webhook_config
  ADD CONSTRAINT gateway_webhook_config_deal_mode_check
  CHECK (deal_mode IN ('update_or_create', 'update_only', 'always_create'));
