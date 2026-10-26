-- 122 · LID do WhatsApp no contato (canal por QR code, Z-API)
--
-- O WhatsApp passou a identificar parte das conversas por um LID
-- ("171459523662078@lid"): um id privado que NÃO vira telefone. No canal por
-- QR, o eco do que o vendedor manda pelo celular chega muitas vezes só com o
-- LID; sem guardar o LID no contato, cada eco abria um contato novo com o LID
-- no lugar do telefone, e a resposta do vendedor caía numa conversa fantasma
-- em vez da conversa do cliente.
--
--   wa_lid   LID do contato, sempre no formato "<dígitos>@lid". O webhook
--            procura o contato por ele antes do telefone. Contato que só
--            chegou pelo LID fica com phone null (como os do Instagram) e
--            ganha o telefone quando o cliente aparecer com ele.
--
-- Idempotente. Só adiciona coluna e índice; o saneamento dos contatos que já
-- nasceram com o LID no telefone é o script
-- scripts/saneia-lid-e-status-qr.mjs (revisado e rodado à parte).

alter table public.contacts
  add column if not exists wa_lid text;

create unique index if not exists contacts_account_wa_lid_uniq
  on public.contacts (account_id, wa_lid)
  where wa_lid is not null;

comment on column public.contacts.wa_lid is
  'LID do WhatsApp ("<dígitos>@lid"), id privado que não vira telefone. Canal por QR code (Z-API) casa o contato por ele.';
