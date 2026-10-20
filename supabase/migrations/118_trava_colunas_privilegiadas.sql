-- 118 · Segurança: o navegador não mexe mais em quem é dono de quê.
--
-- Equivale à correção do upstream (ArnasDon/wacrm, migração
-- 034_fix_profiles_update_rls.sql, alerta GHSA-fg5p-2qc3-jmxr), ampliada para
-- o que só existe neste fork: o cadastro cria login sem profile (061), o
-- webhook do Stripe acha o comprador pelo e-mail do profile e a conta guarda
-- plano, assentos e o cliente do Stripe.
--
-- O problema
--
--   RLS decide QUAIS LINHAS a pessoa pode gravar, não QUAIS COLUNAS. As
--   policies de profiles só conferem `auth.uid() = user_id`, e o papel
--   `authenticated` (o navegador) tem UPDATE e INSERT em todas as colunas.
--   `is_account_member()` confia em profiles.account_id e account_role. Daí:
--
--     -- vendedor/viewer vira owner da própria conta
--     update profiles set account_role = 'owner' where user_id = auth.uid();
--     -- entra em outra conta sabendo o UUID
--     update profiles set account_id = '<outra>' where user_id = auth.uid();
--     -- login recém-criado (sem profile) cria o profile já dentro de outra
--     -- conta como owner; o gatilho profiles_sync_membership ainda grava a
--     -- participação em account_members
--     insert into profiles (user_id, account_id, account_role)
--       values (auth.uid(), '<outra>', 'owner');
--     -- toma o e-mail de outra pessoa: get_user_id_by_email() (webhook do
--     -- Stripe) passaria a achar o atacante quando a vítima pagar
--     update profiles set email = '<email da vitima>' where user_id = auth.uid();
--
--   Em accounts, a policy accounts_update libera admin+ e só os campos de
--   suspensão estão congelados (094). Um admin do cliente consegue gravar
--   plan, subscription_status e assentos_extras (src/lib/billing/quota.ts e o
--   teto de convites leem esses campos), apontar stripe_customer_id para outro
--   cliente (o /api/billing/portal abre o portal desse customer) e trocar
--   owner_user_id.
--
-- A correção
--
--   Dois gatilhos BEFORE que recusam (42501) a gravação dessas colunas quando
--   quem grava é o navegador (`current_user` = authenticated ou anon). Quem
--   grava de verdade continua livre:
--     - as funções SECURITY DEFINER do dono postgres (switch_account,
--       redeem_invitation, set_member_role, transfer_account_ownership,
--       provision_account, remove_account_member): dentro delas
--       current_user = postgres;
--     - o servidor com a service role (webhook do Stripe, checkout, aba
--       Membros editando `funcao`): current_user = service_role;
--     - SQL Editor / migrações: postgres.
--   O que o navegador grava hoje e continua passando: profiles.full_name e
--   avatar_url (Configurações > Perfil), accounts.name (/api/account),
--   accounts.accent (Aparência) e accounts.default_currency (Negócios).
--
--   Por que gatilho e não REVOKE de coluna: o Supabase dá UPDATE na TABELA
--   inteira para authenticated; REVOKE de uma coluna não tira o que veio pela
--   tabela. Teria de revogar a tabela e regravar coluna por coluna, e toda
--   coluna nova nasceria travada sem aviso.
--
--   As funções dos gatilhos são SECURITY INVOKER de propósito: se fossem
--   DEFINER, current_user seria sempre postgres e a trava não valeria.
--
--   Se um dia surgir uma RPC que NÃO é SECURITY DEFINER e precisa gravar
--   essas colunas, ou um papel novo de cliente, ajuste a lista abaixo.
--
-- Teste: supabase/tests/118_trava_colunas_privilegiadas.test.sql
-- Nenhuma tabela nova.

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
create or replace function public.trava_colunas_privilegiadas_profiles()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- Login não é conta (061): profile só nasce por provision_account (compra)
  -- ou redeem_invitation (convite). Nenhuma tela cria profile pelo navegador.
  if tg_op = 'INSERT' then
    raise exception 'profile só é criado pela compra ou pelo convite'
      using errcode = 'insufficient_privilege';
  end if;

  if new.id           is distinct from old.id
     or new.user_id      is distinct from old.user_id
     or new.account_id   is distinct from old.account_id
     or new.account_role is distinct from old.account_role
     or new.role         is distinct from old.role
     or new.email        is distinct from old.email
  then
    raise exception 'conta, papel e e-mail do profile não podem ser alterados direto; use as funções de convite, troca de conta e membros'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

alter function public.trava_colunas_privilegiadas_profiles() owner to postgres;

drop trigger if exists profiles_trava_colunas_privilegiadas on public.profiles;
create trigger profiles_trava_colunas_privilegiadas
  before insert or update on public.profiles
  for each row execute function public.trava_colunas_privilegiadas_profiles();

-- ------------------------------------------------------------
-- accounts
-- ------------------------------------------------------------
-- access_suspends_at e suspension_reason continuam com o gatilho da 094
-- (accounts_freeze_suspension_fields), que devolve o valor antigo em silêncio.
create or replace function public.trava_colunas_cobranca_accounts()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id                     is distinct from old.id
     or new.owner_user_id          is distinct from old.owner_user_id
     or new.plan                   is distinct from old.plan
     or new.subscription_status    is distinct from old.subscription_status
     or new.assentos_extras        is distinct from old.assentos_extras
     or new.stripe_customer_id     is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
  then
    raise exception 'plano, assinatura, assentos e dono da conta só mudam pela cobrança ou pela transferência de propriedade'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

alter function public.trava_colunas_cobranca_accounts() owner to postgres;

drop trigger if exists accounts_trava_colunas_cobranca on public.accounts;
create trigger accounts_trava_colunas_cobranca
  before update on public.accounts
  for each row execute function public.trava_colunas_cobranca_accounts();
