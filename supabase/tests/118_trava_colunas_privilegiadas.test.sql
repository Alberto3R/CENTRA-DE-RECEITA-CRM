-- Teste da migração 118 (trava de colunas privilegiadas em profiles e accounts).
--
-- Roda inteiro dentro de uma transação e termina em ROLLBACK: cria logins,
-- contas e convites de teste, simula cada papel (navegador = authenticated,
-- servidor = service_role) e desfaz tudo no fim. Não deixa rastro.
--
-- Como rodar (como postgres): SQL Editor do Supabase, `psql -f`, ou a
-- ferramenta execute_sql do MCP, num branch ou no banco já com a 118.
-- Passou = a última linha devolve 'OK 118'. Qualquer caso que falhe aborta com
-- 'FALHOU <caso>: ...'. Sem a 118 aplicada, o teste falha no caso a1.
--
-- Cobre:
--   a) o navegador não muda account_id, account_role, role, email nem user_id
--      do profile, e login sem profile não cria profile; nome e foto passam;
--   b) switch_account, redeem_invitation (convite novo e legado),
--      set_member_role, transfer_account_ownership, provision_account e a
--      edição de `funcao` pela aba Membros continuam funcionando;
--   c) admin e owner não mudam plan, subscription_status, assentos_extras,
--      stripe_* nem owner_user_id; nome, cor e moeda passam; o webhook do
--      Stripe (service_role) grava tudo.

begin;

-- ------------------------------------------------------------
-- Ajudantes (somem no rollback). SECURITY INVOKER de propósito.
-- ------------------------------------------------------------
create function public._t118_como(p_uid uuid, p_papel text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', p_papel)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

create function public._t118_recusa(p_sql text, p_caso text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege then
    raise notice 'ok %', p_caso;
    return;
  end;
  raise exception 'FALHOU %: a gravação passou e devia ser recusada', p_caso;
end $$;

create function public._t118_passa(p_sql text, p_caso text, p_linhas int default null)
returns void language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if p_linhas is not null and n <> p_linhas then
    raise exception 'FALHOU %: esperava % linha(s), gravou %', p_caso, p_linhas, n;
  end if;
  raise notice 'ok %', p_caso;
end $$;

create function public._t118_confere(p_ok boolean, p_caso text)
returns void language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FALHOU %', p_caso;
  end if;
  raise notice 'ok %', p_caso;
end $$;

grant execute on function public._t118_como(uuid, text),
  public._t118_recusa(text, text), public._t118_passa(text, text, int),
  public._t118_confere(boolean, text)
  to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Massa de teste (como postgres)
--   a1 dono da conta A · b1 dono da conta B
--   a2 membro (agent) da A · a3 viewer da A e agent da B (troca de conta)
--   c1 login sem profile (convite novo) · c2 dono de conta vazia (convite legado)
--   c3 comprador novo (provision_account)
-- ------------------------------------------------------------
insert into auth.users (id, email) values
  ('11180000-0000-4000-8000-0000000000a1', 't118-dono-a@teste.invalid'),
  ('11180000-0000-4000-8000-0000000000b1', 't118-dono-b@teste.invalid'),
  ('11180000-0000-4000-8000-0000000000a2', 't118-membro@teste.invalid'),
  ('11180000-0000-4000-8000-0000000000a3', 't118-multi@teste.invalid'),
  ('11180000-0000-4000-8000-0000000000c1', 't118-convidado@teste.invalid'),
  ('11180000-0000-4000-8000-0000000000c2', 't118-legado@teste.invalid'),
  ('11180000-0000-4000-8000-0000000000c3', 't118-comprador@teste.invalid');

select set_config('t118.conta_a', public.provision_account('11180000-0000-4000-8000-0000000000a1', 'T118 A')::text, true);
select set_config('t118.conta_b', public.provision_account('11180000-0000-4000-8000-0000000000b1', 'T118 B')::text, true);
select set_config('t118.conta_legado', public.provision_account('11180000-0000-4000-8000-0000000000c2', 'T118 legado')::text, true);

insert into public.profiles (user_id, email, full_name, account_id, account_role) values
  ('11180000-0000-4000-8000-0000000000a2', 't118-membro@teste.invalid', 'Membro', current_setting('t118.conta_a')::uuid, 'agent'),
  ('11180000-0000-4000-8000-0000000000a3', 't118-multi@teste.invalid', 'Multi', current_setting('t118.conta_a')::uuid, 'viewer');
insert into public.account_members (account_id, user_id, role) values
  (current_setting('t118.conta_b')::uuid, '11180000-0000-4000-8000-0000000000a3', 'agent');

insert into public.account_invitations (account_id, token_hash, role, created_by_user_id, expires_at, funcao) values
  (current_setting('t118.conta_a')::uuid, 't118-convite-novo', 'agent', '11180000-0000-4000-8000-0000000000a1', now() + interval '1 day', 'sdr'),
  (current_setting('t118.conta_b')::uuid, 't118-convite-legado', 'agent', '11180000-0000-4000-8000-0000000000b1', now() + interval '1 day', null);

-- ============================================================
-- a) Navegador não mexe em conta, papel nem e-mail do profile
-- ============================================================
select public._t118_como('11180000-0000-4000-8000-0000000000a2', 'authenticated');
set local role authenticated;
select public._t118_recusa($q$update public.profiles set account_role = 'owner' where user_id = auth.uid()$q$,
  'a1 membro não vira owner');
select public._t118_recusa(format($q$update public.profiles set account_id = %L where user_id = auth.uid()$q$, current_setting('t118.conta_b')),
  'a2 membro não entra em outra conta');
select public._t118_recusa($q$update public.profiles set role = 'admin' where user_id = auth.uid()$q$,
  'a3 membro não muda profiles.role');
select public._t118_recusa($q$update public.profiles set email = 't118-dono-b@teste.invalid' where user_id = auth.uid()$q$,
  'a4 membro não toma o e-mail de outra pessoa');
select public._t118_recusa($q$update public.profiles set user_id = '11180000-0000-4000-8000-0000000000c1' where user_id = auth.uid()$q$,
  'a5 membro não troca user_id');
select public._t118_passa($q$update public.profiles set full_name = 'Membro Renomeado', avatar_url = null where user_id = auth.uid()$q$,
  'a6 membro edita nome e foto (Configurações > Perfil)', 1);
reset role;

select public._t118_como('11180000-0000-4000-8000-0000000000a1', 'authenticated');
set local role authenticated;
select public._t118_recusa(format($q$update public.profiles set account_id = %L where user_id = auth.uid()$q$, current_setting('t118.conta_b')),
  'a7 nem o owner troca account_id direto');
reset role;

select public._t118_como('11180000-0000-4000-8000-0000000000c1', 'authenticated');
set local role authenticated;
select public._t118_recusa(format($q$insert into public.profiles (user_id, email, account_id, account_role) values (auth.uid(), 'x@teste.invalid', %L, 'owner')$q$, current_setting('t118.conta_a')),
  'a8 login sem profile não se cria owner de outra conta');
select public._t118_recusa($q$insert into public.profiles (user_id, email) values (auth.uid(), 'x@teste.invalid')$q$,
  'a9 login sem profile não cria profile nenhum pelo navegador');
reset role;

select public._t118_confere(
  not exists (select 1 from public.account_members where user_id = '11180000-0000-4000-8000-0000000000c1'),
  'a10 nenhuma participação criada para o login sem profile');
select public._t118_confere(
  (select account_role = 'agent' and account_id = current_setting('t118.conta_a')::uuid and full_name = 'Membro Renomeado'
     from public.profiles where user_id = '11180000-0000-4000-8000-0000000000a2'),
  'a11 profile do membro intacto, só o nome mudou');

-- ============================================================
-- b) Caminhos legítimos continuam funcionando
-- ============================================================
select public._t118_como('11180000-0000-4000-8000-0000000000a3', 'authenticated');
set local role authenticated;
select public._t118_passa(format($q$select public.switch_account(%L)$q$, current_setting('t118.conta_b')),
  'b1 switch_account para a conta B');
reset role;
select public._t118_confere(
  (select account_id = current_setting('t118.conta_b')::uuid and account_role = 'agent'
     from public.profiles where user_id = '11180000-0000-4000-8000-0000000000a3'),
  'b2 profile foi para a conta B como agent');
select public._t118_como('11180000-0000-4000-8000-0000000000a3', 'authenticated');
set local role authenticated;
select public._t118_passa(format($q$select public.switch_account(%L)$q$, current_setting('t118.conta_a')),
  'b3 switch_account de volta para a conta A');
reset role;
select public._t118_confere(
  (select account_id = current_setting('t118.conta_a')::uuid and account_role = 'viewer'
     from public.profiles where user_id = '11180000-0000-4000-8000-0000000000a3'),
  'b4 profile voltou para a conta A como viewer');

select public._t118_como('11180000-0000-4000-8000-0000000000c1', 'authenticated');
set local role authenticated;
select public._t118_passa($q$select public.redeem_invitation('t118-convite-novo')$q$,
  'b5 redeem_invitation (login sem profile)');
reset role;
select public._t118_confere(
  (select p.account_id = current_setting('t118.conta_a')::uuid and p.account_role = 'agent' and p.funcao = 'sdr'
     from public.profiles p where p.user_id = '11180000-0000-4000-8000-0000000000c1')
  and exists (select 1 from public.account_members m
               where m.user_id = '11180000-0000-4000-8000-0000000000c1'
                 and m.account_id = current_setting('t118.conta_a')::uuid and m.role = 'agent'),
  'b6 convidado entrou na conta A como agent (profile + participação)');

select public._t118_como('11180000-0000-4000-8000-0000000000c2', 'authenticated');
set local role authenticated;
select public._t118_passa($q$select public.redeem_invitation('t118-convite-legado')$q$,
  'b7 redeem_invitation (caminho legado: conta própria vazia)');
reset role;
select public._t118_confere(
  (select account_id = current_setting('t118.conta_b')::uuid and account_role = 'agent'
     from public.profiles where user_id = '11180000-0000-4000-8000-0000000000c2')
  and not exists (select 1 from public.accounts where id = current_setting('t118.conta_legado')::uuid),
  'b8 legado foi para a conta B e a conta vazia foi apagada');

select public._t118_como('11180000-0000-4000-8000-0000000000a1', 'authenticated');
set local role authenticated;
select public._t118_passa($q$select public.set_member_role('11180000-0000-4000-8000-0000000000a2', 'admin')$q$,
  'b9 set_member_role: owner promove membro a admin');
reset role;
select public._t118_confere(
  (select account_role = 'admin' from public.profiles where user_id = '11180000-0000-4000-8000-0000000000a2'),
  'b10 membro agora é admin');

select public._t118_como('11180000-0000-4000-8000-0000000000b1', 'authenticated');
set local role authenticated;
select public._t118_passa($q$select public.transfer_account_ownership('11180000-0000-4000-8000-0000000000c2')$q$,
  'b11 transfer_account_ownership');
reset role;
select public._t118_confere(
  (select owner_user_id = '11180000-0000-4000-8000-0000000000c2' from public.accounts where id = current_setting('t118.conta_b')::uuid)
  and (select account_role = 'owner' from public.profiles where user_id = '11180000-0000-4000-8000-0000000000c2')
  and (select account_role = 'admin' from public.profiles where user_id = '11180000-0000-4000-8000-0000000000b1'),
  'b12 dono da conta B trocou (accounts.owner_user_id e papéis)');

select public._t118_como(null, 'service_role');
set local role service_role;
select public._t118_passa($q$update public.profiles set funcao = 'closer' where user_id = '11180000-0000-4000-8000-0000000000a2'$q$,
  'b13 aba Membros grava funcao pelo servidor (service_role)', 1);
select public._t118_passa($q$select public.provision_account('11180000-0000-4000-8000-0000000000c3', 'T118 comprador')$q$,
  'b14 provision_account pelo webhook (service_role)');
reset role;
select public._t118_confere(
  (select account_role = 'owner' and account_id is not null from public.profiles where user_id = '11180000-0000-4000-8000-0000000000c3'),
  'b15 comprador novo virou owner da própria conta');

-- ============================================================
-- c) Cobrança da conta só muda pelo servidor
-- ============================================================
select public._t118_como('11180000-0000-4000-8000-0000000000a2', 'authenticated');  -- admin da A (b9)
set local role authenticated;
select public._t118_recusa(format($q$update public.accounts set plan = 'enterprise' where id = %L$q$, current_setting('t118.conta_a')),
  'c1 admin não muda plan');
select public._t118_recusa(format($q$update public.accounts set subscription_status = 'active' where id = %L$q$, current_setting('t118.conta_a')),
  'c2 admin não muda subscription_status');
select public._t118_recusa(format($q$update public.accounts set assentos_extras = 99 where id = %L$q$, current_setting('t118.conta_a')),
  'c3 admin não muda assentos_extras');
select public._t118_recusa(format($q$update public.accounts set stripe_customer_id = 'cus_de_outro' where id = %L$q$, current_setting('t118.conta_a')),
  'c4 admin não aponta para outro cliente do Stripe');
select public._t118_recusa(format($q$update public.accounts set stripe_subscription_id = 'sub_de_outro' where id = %L$q$, current_setting('t118.conta_a')),
  'c5 admin não muda stripe_subscription_id');
select public._t118_recusa(format($q$update public.accounts set owner_user_id = auth.uid() where id = %L$q$, current_setting('t118.conta_a')),
  'c6 admin não se faz dono da conta');
select public._t118_passa(format($q$update public.accounts set name = 'T118 A renomeada', accent = 'violet', default_currency = 'USD' where id = %L$q$, current_setting('t118.conta_a')),
  'c7 admin muda nome, cor e moeda', 1);
reset role;

select public._t118_como('11180000-0000-4000-8000-0000000000a1', 'authenticated');  -- owner da A
set local role authenticated;
select public._t118_recusa(format($q$update public.accounts set plan = 'enterprise', subscription_status = 'active' where id = %L$q$, current_setting('t118.conta_a')),
  'c8 nem o owner muda plano e assinatura');
reset role;

select public._t118_como(null, 'service_role');
set local role service_role;
select public._t118_passa(format($q$update public.accounts set plan = 'pro', subscription_status = 'active', assentos_extras = 2, stripe_customer_id = 'cus_t118', stripe_subscription_id = 'sub_t118', access_suspends_at = null, suspension_reason = null where id = %L$q$, current_setting('t118.conta_a')),
  'c9 webhook do Stripe (service_role) grava plano e assinatura', 1);
reset role;
select public._t118_confere(
  (select plan = 'pro' and subscription_status = 'active' and assentos_extras = 2 and name = 'T118 A renomeada'
     from public.accounts where id = current_setting('t118.conta_a')::uuid),
  'c10 conta A com o plano gravado pelo servidor');

select 'OK 118' as resultado;

rollback;
