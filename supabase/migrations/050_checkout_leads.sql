-- ============================================================
-- 050_checkout_leads.sql — leads da página de vendas (Central de Receita)
--
-- O botão de assinar abre um formulário (dados da empresa) → grava aqui →
-- redireciona pro checkout do Stripe. Guardar o lead ANTES do pagamento
-- garante o contato mesmo se a pessoa não concluir a compra.
--
-- Não é multi-tenant (é o funil de venda do próprio produto). Só o
-- service_role (endpoint /api/checkout/lead) escreve/lê — RLS ligado sem
-- políticas públicas.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.checkout_leads (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  empresa     text,
  nome        text,
  email       text NOT NULL,
  whatsapp    text,
  plano       text,   -- starter | pro
  ciclo       text,   -- mensal | anual
  origem      text DEFAULT 'landing_central_receita',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkout_leads_created_idx
  ON public.checkout_leads(created_at DESC);

ALTER TABLE public.checkout_leads ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso apenas via service_role (o endpoint público).
