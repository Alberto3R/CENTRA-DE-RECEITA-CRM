-- Instagram Direct como canal — Fase 1 (modelo de dados).
--
-- Generaliza `whatsapp_config` (que já é a tabela de CANAIS, migration 056)
-- para aceitar o tipo 'instagram' ao lado de 'whatsapp', e dá aos contatos
-- uma identidade Instagram (IGSID), já que uma DM não tem telefone.
--
-- Espelha o precedente que já existe no schema:
--   * canais 1-por-linha por conta (056);
--   * contato deduplicado por identidade e não por telefone
--     (índice `contacts_account_wa_user_id_uniq` do WhatsApp username).
--
-- Idempotente. Só AFROUXA restrições (phone / phone_number_id viram
-- nullable) e ADICIONA colunas + índices parciais que só valem para as
-- novas identidades IG — nenhuma linha existente é tocada.

-- ============================================================
-- 2.1 Canais — tipo do canal + identidade Instagram
-- ============================================================
alter table public.whatsapp_config
  add column if not exists channel_type text not null default 'whatsapp',
  add column if not exists ig_user_id text,   -- IG Business user id (17841439327821349)
  add column if not exists ig_page_id text;   -- Facebook Page id  (152902442083026)

-- CHECK do tipo — adicionado via DO para ser re-runnable (não há
-- ADD CONSTRAINT IF NOT EXISTS no Postgres).
do $$
begin
  alter table public.whatsapp_config
    add constraint whatsapp_config_channel_type_check
    check (channel_type in ('whatsapp', 'instagram'));
exception
  when duplicate_object then null;
end $$;

-- Canal instagram não tem número: phone_number_id passa a nullable.
-- (waba_id já é nullable.) O UNIQUE(phone_number_id) continua valendo —
-- NULLs são distintos no Postgres, então vários canais IG convivem.
alter table public.whatsapp_config
  alter column phone_number_id drop not null;

-- Uma conta IG por linha (identidade única do canal).
create unique index if not exists whatsapp_config_ig_user_unique
  on public.whatsapp_config (ig_user_id) where ig_user_id is not null;

comment on column public.whatsapp_config.channel_type is
  'Tipo do canal: whatsapp | instagram. Roteia ingestão e envio.';
comment on column public.whatsapp_config.ig_user_id is
  'IG Business user id — é o recipient.id das DMs. Só para channel_type=instagram.';
comment on column public.whatsapp_config.ig_page_id is
  'Facebook Page id ligada à conta IG. Envio da DM: POST /{ig_page_id}/messages.';

-- ============================================================
-- 2.2 Contatos — identidade Instagram (IGSID)
-- ============================================================
-- phone deixa de ser obrigatório (DM não tem telefone). O generated
-- column `phone_normalized` vira NULL quando phone é NULL, e o índice
-- único parcial `idx_contacts_account_phone_normalized`
-- (WHERE phone_normalized <> '') simplesmente ignora esses contatos.
alter table public.contacts
  alter column phone drop not null,
  add column if not exists instagram_id text,       -- IGSID (Instagram-scoped id)
  add column if not exists instagram_username text; -- @handle

-- Dedupe por IGSID — espelha `contacts_account_wa_user_id_uniq`.
create unique index if not exists contacts_account_igsid_unique
  on public.contacts (account_id, instagram_id) where instagram_id is not null;

comment on column public.contacts.instagram_id is
  'IGSID (Instagram-scoped user id) do contato. Identidade no canal instagram.';
comment on column public.contacts.instagram_username is
  '@username do Instagram (enriquecido via Graph). Exibido no inbox no lugar do telefone.';

-- ============================================================
-- 2.3 Conversas / mensagens
-- ============================================================
-- `conversations.channel_id` já existe (056) e é reusado: a conversa IG
-- aponta para o canal channel_type='instagram'. Este schema NÃO tem
-- `conversations.phone_number_id`, então não há nada a afrouxar aqui.
-- `messages` também é reusado como está (sender_type/content_type).
