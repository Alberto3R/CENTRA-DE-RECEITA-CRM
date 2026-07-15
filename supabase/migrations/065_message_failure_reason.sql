-- Motivo da falha de envio (WhatsApp) — visível no CRM.
-- ============================================================
-- Quando a Meta recusa a entrega (status=failed no webhook), ela manda o motivo
-- em statuses[].errors[] (code + title + message). O handleStatusUpdate atual
-- só copiava o status e DESCARTAVA o motivo — por isso a mensagem virava um "X
-- vermelho" sem explicação. Estas colunas guardam o porquê, pra mostrar na UI.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS error_code  text,
  ADD COLUMN IF NOT EXISTS error_title text;

COMMENT ON COLUMN public.messages.error_code  IS 'Código do erro da Meta quando status=failed (ex.: 131049).';
COMMENT ON COLUMN public.messages.error_title IS 'Motivo legível da falha de envio (title/details da Meta).';
