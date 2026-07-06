-- ===== 028_ai_agent.sql =====
-- ============================================================
-- 028_ai_agent.sql — agente de IA conversacional por conta
--
-- Cada marca (account) pode ter um agente de IA que responde no
-- WhatsApp automaticamente (substitui o bot do Make). Config por conta:
-- liga/desliga, persona (system prompt), modelo, etc. O motor vive em
-- src/lib/ai-agent e é disparado pelo webhook ao receber mensagem.
--
-- Handoff: quando o agente decide passar pra humano (ou um humano
-- responde manualmente), a conversa marca `ai_handoff = true` e o bot
-- para de responder naquela conversa até ser reaberto.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_agent_config (
  account_id      uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT false,
  system_prompt   text NOT NULL DEFAULT '',
  model           text NOT NULL DEFAULT 'claude-sonnet-4-6',
  max_tokens      integer NOT NULL DEFAULT 1500,
  -- Palavra/expressão que, vinda do cliente, força o handoff pra humano
  -- (além do handoff que o próprio modelo pode decidir). Ex.: "atendente".
  handoff_keyword text,
  -- Linha curta exibida ao cliente quando cai em handoff.
  handoff_message text NOT NULL DEFAULT 'Vou te passar pro nosso time, um instante 🙂',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_agent_config ENABLE ROW LEVEL SECURITY;

-- Membros leem; admin+ editam (config é settings-class, como whatsapp_config).
DROP POLICY IF EXISTS "members read ai config" ON public.ai_agent_config;
CREATE POLICY "members read ai config" ON public.ai_agent_config
  FOR SELECT USING (public.is_account_member(account_id));

DROP POLICY IF EXISTS "admins write ai config" ON public.ai_agent_config;
CREATE POLICY "admins write ai config" ON public.ai_agent_config
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Flag de handoff por conversa: bot para de responder quando true.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_handoff boolean NOT NULL DEFAULT false;

-- ===== 029_lead_attribution.sql =====
-- ============================================================
-- 029_lead_attribution.sql — atribuição de leads (tráfego pago)
--
-- Uma linha por lead capturado, guardando a origem de marketing pra
-- relatórios futuros: UTMs + ângulo do anúncio + ids do Meta pixel
-- (fbclid/fbp/fbc) e, na Fase 2, o ctwa_clid dos anúncios Click-to-
-- WhatsApp. Liga ao contato e ao deal criados na captação.
--
-- Preenchida por:
--   - POST /api/leads (Funil 2: landing → CRM)
--   - (futuro) webhook do WhatsApp, quando vier referral.ctwa_clid
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_attribution (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  deal_id       uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  -- de onde veio: 'funil2-landing', 'ctwa', 'organico', ...
  source        text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  -- ângulo do criativo (?ang=E|B na landing)
  ang           text,
  -- ids de clique/cookie do Meta (pra Conversions API e dedup)
  fbclid        text,
  fbp           text,
  fbc           text,
  event_id      text,
  -- Click-to-WhatsApp Click ID (Fase 2 — vem do referral do webhook)
  ctwa_clid     text,
  ad_id         text,
  -- classificação do gate do funil: verde | amarelo | vermelho
  classificacao text,
  landing_url   text,
  -- payload bruto da captação, pra auditoria e relatórios ad-hoc
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_attr_account_created
  ON public.lead_attribution(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_attr_contact
  ON public.lead_attribution(contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_attr_ctwa
  ON public.lead_attribution(ctwa_clid) WHERE ctwa_clid IS NOT NULL;

ALTER TABLE public.lead_attribution ENABLE ROW LEVEL SECURITY;

-- Membros da conta leem (relatórios). A escrita é via service-role no
-- endpoint de captação (que não tem sessão de usuário), então não há
-- policy de INSERT pra clientes — fica fechado por padrão.
DROP POLICY IF EXISTS "members read lead_attribution" ON public.lead_attribution;
CREATE POLICY "members read lead_attribution" ON public.lead_attribution
  FOR SELECT USING (public.is_account_member(account_id));

-- ===== 030_capi_conversions.sql =====
-- ============================================================
-- 030_capi_conversions.sql — devolver conversões pra Meta (CAPI / CTWA)
--
-- Quando um deal entra num estágio marcado com `capi_event`, um trigger
-- chama (async, via pg_net) o endpoint /api/conversions/fire, que manda
-- o evento pra Conversions API da Meta com o ctwa_clid do lead.
--
-- O token interno do endpoint mora em `app_secrets` (inserido fora da
-- migration, via execute_sql) pra não vazar no repositório.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Segredos internos lidos por triggers. Sem policy de cliente (RLS nega
-- tudo); só service-role e funções SECURITY DEFINER acessam.
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

-- Config da Conversions API por conta (marca)
CREATE TABLE IF NOT EXISTS public.meta_capi_config (
  account_id      uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT false,
  pixel_id        text,
  capi_token      text,            -- criptografado (AES-256-GCM)
  test_event_code text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_capi_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read capi config" ON public.meta_capi_config;
CREATE POLICY "members read capi config" ON public.meta_capi_config
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "admins write capi config" ON public.meta_capi_config;
CREATE POLICY "admins write capi config" ON public.meta_capi_config
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Qual evento de conversão cada estágio dispara (NULL = nenhum).
-- Ex.: "Raio-X agendado" -> 'Schedule', "Ganho" -> 'Purchase'.
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS capi_event text;

-- Trigger: deal muda pra um estágio com capi_event -> dispara a conversão.
CREATE OR REPLACE FUNCTION public.fire_conversion_on_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
  v_token text;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id OR NEW.stage_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT capi_event INTO v_event FROM public.pipeline_stages WHERE id = NEW.stage_id;
  IF v_event IS NULL OR v_event = '' THEN RETURN NEW; END IF;
  SELECT value INTO v_token FROM public.app_secrets WHERE key = 'conversions_internal_token';
  IF v_token IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := 'https://sales-3r-crm.vercel.app/api/conversions/fire',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-conv-token', v_token
    ),
    body := jsonb_build_object('deal_id', NEW.id, 'event_name', v_event)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_fire_conversion ON public.deals;
CREATE TRIGGER deals_fire_conversion
  AFTER UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fire_conversion_on_stage();

-- ===== 031_bsuid.sql =====
-- ============================================================
-- 031_bsuid.sql — suporte a WhatsApp Business-Scoped User ID (BSUID)
--
-- Com os usernames do WhatsApp (obrigatório ~jun/2026), um lead pode
-- chegar identificado por um BSUID (ex.: "BR.13491208…") em vez do
-- telefone. Guardamos o BSUID no contato pra (a) deduplicar com exatidão
-- e (b) conseguir responder mesmo sem telefone (o BSUID é aceito no `to`).
-- ============================================================

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS wa_user_id text;

-- Um BSUID identifica unicamente um par usuário↔conta.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_account_wa_user_id_uniq
  ON public.contacts (account_id, wa_user_id)
  WHERE wa_user_id IS NOT NULL;

-- ===== 032_account_accent.sql =====
-- ============================================================
-- 032_account_accent.sql — cor de destaque (paleta) por conta/marca
--
-- Antes o accent era global por dispositivo (localStorage), então mudar a
-- cor numa marca mudava em todas. Agora cada conta tem o seu `accent`
-- (um ThemeId, ex. 'sales3r'); o app aplica o da marca ativa ao trocar de
-- conta. NULL = cai no tema padrão. Admins da conta podem alterar
-- (policy `accounts_update` já existente, is_account_member(id,'admin')).
-- ============================================================

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS accent text;

-- ===== 033_gateway_webhooks.sql =====
-- ============================================================
-- 033_gateway_webhooks.sql — webhooks de gateway de pagamento (Voomp etc.)
--
-- Recebe vendas/abandonos de um gateway e joga o lead num funil, com tag de
-- produto e na etapa do evento. Config por conta (token na URL identifica a
-- conta + o mapeamento), pra a mesma infra servir vários clientes via UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gateway_webhook_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  provider    text NOT NULL DEFAULT 'voomp',
  token       text NOT NULL UNIQUE,          -- segredo na URL do webhook
  pipeline_id uuid REFERENCES public.pipelines(id) ON DELETE SET NULL,
  -- mapeia trigger do gateway -> etapa (stage_id) OU a string 'refund'
  -- ex.: {"salePaid":"<uuid>","abandonedCart":"<uuid>","saleRefunded":"refund"}
  stage_map   jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gateway_webhook_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read gateway config" ON public.gateway_webhook_config;
CREATE POLICY "members read gateway config" ON public.gateway_webhook_config
  FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS "admins write gateway config" ON public.gateway_webhook_config;
CREATE POLICY "admins write gateway config" ON public.gateway_webhook_config
  FOR ALL USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Idempotência: cada (config, order_id, trigger) processado uma vez só.
CREATE TABLE IF NOT EXISTS public.gateway_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id  uuid NOT NULL REFERENCES public.gateway_webhook_config(id) ON DELETE CASCADE,
  order_id   text NOT NULL,
  trigger    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (config_id, order_id, trigger)
);
ALTER TABLE public.gateway_events ENABLE ROW LEVEL SECURITY;
-- sem policy de cliente: só service-role (o endpoint) escreve/lê.

-- ===== 034_funnel_metrics.sql =====
-- ============================================================
-- 034_funnel_metrics.sql — métricas de funil & performance no Painel
--
-- Suporta: taxa de conexão, taxa de conversão, ciclo de venda, motivos
-- de perda, leads sem follow-up humano. Adiciona:
--  • pipeline_stages.is_connection — marca a etapa "conectei com o lead"
--  • deals.closed_at / lost_reason  — fechamento + motivo da perda
--  • trigger que carimba closed_at ao ganhar/perder (limpa ao reabrir)
--  • RPC dashboard_funnel_metrics() — calcula tudo, escopado pela conta
--    ativa (SECURITY INVOKER → RLS aplica).
-- ============================================================

-- Etapa de conexão (configurável por funil; default = etapas "Conexão")
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS is_connection boolean NOT NULL DEFAULT false;
UPDATE public.pipeline_stages SET is_connection = true WHERE name ILIKE 'conex%' AND NOT is_connection;

-- Fechamento do negócio + motivo de perda
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS closed_at  timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS lost_reason text;

-- Carimba closed_at quando ganha/perde; limpa (e zera motivo) se reabrir.
CREATE OR REPLACE FUNCTION public.set_deal_closed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('won', 'lost') THEN
    IF NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
  ELSE
    NEW.closed_at := NULL;
    NEW.lost_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS deals_set_closed_at ON public.deals;
CREATE TRIGGER deals_set_closed_at
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.set_deal_closed_at();

-- Métricas de funil da CONTA ATIVA (RLS aplica via SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.dashboard_funnel_metrics()
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH conn AS (
    SELECT pipeline_id, min(position) AS conn_pos
    FROM pipeline_stages WHERE is_connection GROUP BY pipeline_id
  ),
  ds AS (
    SELECT d.status, d.created_at, d.closed_at, d.lost_reason,
           ps.position AS pos, c.conn_pos,
           (c.conn_pos IS NOT NULL AND ps.position >= c.conn_pos) AS reached_conn
    FROM deals d
    JOIN pipeline_stages ps ON ps.id = d.stage_id
    LEFT JOIN conn c ON c.pipeline_id = d.pipeline_id
  )
  SELECT json_build_object(
    'total_deals',     (SELECT count(*) FROM ds),
    'with_conn_stage', (SELECT count(*) FROM ds WHERE conn_pos IS NOT NULL),
    'reached_conn',    (SELECT count(*) FROM ds WHERE reached_conn),
    'won',             (SELECT count(*) FROM ds WHERE status = 'won'),
    'won_from_conn',   (SELECT count(*) FROM ds WHERE status = 'won' AND reached_conn),
    'lost',            (SELECT count(*) FROM ds WHERE status = 'lost'),
    'avg_cycle_seconds', (
      SELECT avg(extract(epoch FROM closed_at - created_at))
      FROM ds WHERE status = 'won' AND closed_at IS NOT NULL
    ),
    'loss_reasons', (
      SELECT coalesce(json_agg(json_build_object('reason', reason, 'count', n) ORDER BY n DESC), '[]'::json)
      FROM (
        SELECT coalesce(nullif(trim(lost_reason), ''), 'Não informado') AS reason, count(*) AS n
        FROM ds WHERE status = 'lost' GROUP BY 1
      ) x
    ),
    'no_human_followup', (
      SELECT count(*) FROM conversations cv
      WHERE cv.status = 'open'
        AND (SELECT max(created_at) FROM messages m WHERE m.conversation_id = cv.id AND m.sender_type = 'customer')
            > coalesce((SELECT max(created_at) FROM messages m WHERE m.conversation_id = cv.id AND m.sender_type = 'agent'), '-infinity'::timestamptz)
    )
  );
$$;

