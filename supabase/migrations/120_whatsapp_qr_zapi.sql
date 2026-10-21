-- 120 · WhatsApp Business conectado por QR code (Z-API)
--
-- O cliente escaneia um QR na Central com o app WhatsApp Business do celular
-- (igual ao WhatsApp Web). Não é API oficial: quem mantém a sessão é a Z-API,
-- uma instância por número. O canal continua sendo uma linha de
-- `whatsapp_config` com channel_type='whatsapp' (contato por telefone, inbox
-- de WhatsApp), só que com connection_mode='qr'. Plano em
-- docs/WHATSAPP-BUSINESS-APP-CANAL.md (Caminho B).
--
-- Campos reaproveitados:
--   access_token          → token da instância Z-API (cifrado, AES-256-GCM)
--   display_phone_number  → número que escaneou o QR (vem no "ao conectar")
--   status / connected_at → sessão conectada ou não (eventos de conectar/desconectar)
--   phone_number_id       → NULL (nullable desde a 066; o UNIQUE aceita vários NULL)
--
-- Idempotente. Só adiciona colunas e afrouxa o CHECK de connection_mode.

alter table public.whatsapp_config
  add column if not exists qr_provider        text,        -- 'zapi'
  add column if not exists qr_instance_id     text,        -- ID da instância na Z-API
  add column if not exists qr_client_token    text,        -- token de segurança da conta (cifrado)
  add column if not exists qr_webhook_secret  text,        -- segredo na URL do webhook
  add column if not exists qr_last_error      text;        -- motivo da última queda da sessão

do $$
begin
  alter table public.whatsapp_config
    drop constraint if exists whatsapp_config_connection_mode_check;
  alter table public.whatsapp_config
    add constraint whatsapp_config_connection_mode_check
    check (connection_mode in ('cloud', 'coexistence', 'qr'));
end $$;

-- Canal QR exige a instância e o segredo do webhook.
do $$
begin
  alter table public.whatsapp_config
    add constraint whatsapp_config_qr_requires_instance
    check (
      connection_mode <> 'qr'
      or (qr_instance_id is not null and qr_webhook_secret is not null)
    );
exception
  when duplicate_object then null;
end $$;

-- Uma instância = um canal; o segredo identifica o canal no webhook.
create unique index if not exists whatsapp_config_qr_instance_unique
  on public.whatsapp_config (qr_instance_id)
  where qr_instance_id is not null;

create unique index if not exists whatsapp_config_qr_secret_unique
  on public.whatsapp_config (qr_webhook_secret)
  where qr_webhook_secret is not null;

comment on column public.whatsapp_config.qr_instance_id is
  'Instância da Z-API que mantém a sessão do WhatsApp Business conectado por QR code.';
comment on column public.whatsapp_config.qr_webhook_secret is
  'Segredo do webhook da Z-API (/api/whatsapp/webhook?zapi=<segredo>). A Z-API não assina o webhook.';
