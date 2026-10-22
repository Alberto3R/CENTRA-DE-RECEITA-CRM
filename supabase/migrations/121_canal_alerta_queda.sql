-- 121 · Aviso de queda do WhatsApp conectado por QR code
--
-- Sessão por QR (Z-API, migration 120) cai: o celular desconecta o aparelho,
-- o WhatsApp invalida a sessão, o telefone fica sem internet por dias. Sem
-- aviso, a loja fica horas sem receber e o vendedor "envia" mensagens que
-- param na fila. Quem é avisado mora no próprio canal:
--
--   alert_phone      WhatsApp do responsável (recebe pelo número oficial da 3R)
--   alert_email      e-mail do responsável (sem ele, vai para o dono da conta)
--   qr_alerted_at    quando o aviso de queda saiu — evita repetir a cada
--                    evento da mesma queda e decide se manda o "voltou"
--
-- Idempotente. Só adiciona colunas.

alter table public.whatsapp_config
  add column if not exists alert_phone    text,
  add column if not exists alert_email    text,
  add column if not exists qr_alerted_at  timestamptz;

comment on column public.whatsapp_config.alert_phone is
  'WhatsApp de quem é avisado quando o canal cai (canal por QR code).';
comment on column public.whatsapp_config.alert_email is
  'E-mail de quem é avisado quando o canal cai. Vazio = dono da conta.';
comment on column public.whatsapp_config.qr_alerted_at is
  'Quando o aviso da queda atual saiu. Zera ao reconectar.';
