-- ============================================================
-- 109_lead_capture_tag.sql — tag de identificação no webhook de formulário
--
-- O webhook de pagamento (gateway_webhook_config.default_tag_id) já marcava
-- todo lead com uma tag; o de formulário (lead_capture_config) não. Mesma
-- regra: a tag vai para todo contato que entrar pelo formulário, inclusive
-- quem já existia na base.
-- ============================================================

alter table public.lead_capture_config
  add column if not exists default_tag_id uuid references public.tags(id) on delete set null;
