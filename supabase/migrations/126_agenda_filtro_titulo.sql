-- ============================================================
-- 126_agenda_filtro_titulo.sql — filtro de título nas reservas
--
-- A agenda conectada costuma ser a principal da vendedora, com outras
-- reuniões que também têm convidado de fora. Sem filtro, toda reunião
-- dessas viraria "reserva" e o convidado receberia a confirmação da
-- sessão no WhatsApp. Com title_filter preenchido, só conta o evento cujo
-- título contém o texto (a página de agendamento do Google põe o nome
-- dela no título). Null = comportamento antigo.
-- Aditiva e compatível: pode ser aplicada antes do deploy.
-- ============================================================

alter table public.calendar_booking_sync
  add column if not exists title_filter text;

comment on column public.calendar_booking_sync.title_filter is
  'Só eventos com este texto no título (sem acento/maiúscula) contam como reserva. Null = qualquer evento com convidado externo.';
