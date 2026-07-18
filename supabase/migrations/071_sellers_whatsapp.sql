-- Cobrança individual do agente 3R de acompanhamento (fase 4c).
-- ============================================================
-- O agente cobra cada vendedor no WhatsApp dele (não só o resumo pro gestor).
-- Pra isso o CRM precisa guardar o telefone do vendedor — que não existia.

alter table public.sellers add column if not exists whatsapp text;

comment on column public.sellers.whatsapp is
  'WhatsApp do vendedor (formato 55DDDNUMERO) para a cobrança individual do agente 3R de acompanhamento. Nulo = não recebe cobrança direta (só entra no resumo do gestor).';
