-- ============================================================
-- 102_accounts_assentos_extras.sql — usuário adicional por conta
--
-- O teto de usuários vinha só do plano (plans.ts → usuariosInclusos).
-- Cliente que compra usuário a mais (R$197/assento) não cabia em nenhum
-- plano sem trocar créditos de IA junto. `assentos_extras` soma ao que o
-- plano inclui; o convite (/api/account/invitations) aplica o teto.
-- ============================================================

alter table public.accounts
  add column if not exists assentos_extras integer not null default 0
  check (assentos_extras >= 0);
