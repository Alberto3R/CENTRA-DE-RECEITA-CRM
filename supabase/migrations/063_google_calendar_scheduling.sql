-- Agendamento com Google Calendar — FEATURE DE PRODUTO (multi-tenant).
-- ============================================================
-- Cada CONTA conecta a própria agenda Google (OAuth do app do produto) e o
-- agente de IA marca a call na agenda daquela conta. Duas tabelas:
--   - google_connections: tokens OAuth por conta (SECRETO — só service role).
--   - scheduling_config:  regras de agenda por conta (visível aos membros).

-- ------------------------------------------------------------
-- google_connections — tokens OAuth por conta. RLS ligado SEM policy:
-- ninguém lê via anon/authenticated (os tokens nunca chegam no cliente); só o
-- service role (rotas OAuth/serviço de agenda) acessa. Status/e-mail conectado
-- são expostos por uma rota de API, não por leitura direta da tabela.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.google_connections (
  account_id       uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  google_email     text NOT NULL,
  calendar_id      text NOT NULL DEFAULT 'primary',
  access_token     text,                 -- cifrado (curta duração)
  refresh_token    text NOT NULL,        -- cifrado (longa duração)
  token_expires_at timestamptz,
  scope            text,
  connected_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_connections FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- scheduling_config — regras da agenda por conta (sem segredo). Membros leem;
-- owner/admin editam. business_hours: janela única por dia (MVP).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheduling_config (
  account_id      uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT true,
  timezone        text NOT NULL DEFAULT 'America/Sao_Paulo',
  slot_minutes    integer NOT NULL DEFAULT 20,
  buffer_minutes  integer NOT NULL DEFAULT 10,
  advance_days    integer NOT NULL DEFAULT 7,   -- até quantos dias à frente ofertar
  business_hours  jsonb NOT NULL DEFAULT '{"days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scheduling_config ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer membro da conta. (is_account_member já existe no schema.)
CREATE POLICY scheduling_config_select ON public.scheduling_config
  FOR SELECT USING (public.is_account_member(account_id));

-- Escrita (insert/update): owner ou admin da conta.
CREATE POLICY scheduling_config_write ON public.scheduling_config
  FOR ALL USING (public.is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (public.is_account_member(account_id, 'admin'::account_role_enum));
