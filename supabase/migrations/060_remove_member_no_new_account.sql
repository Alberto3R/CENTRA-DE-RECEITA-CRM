-- Remoção de membro = remoção TOTAL, sem "conta pessoal" de brinde.
--
-- Antes, remover um membro criava uma conta pessoal nova pra ele (mirror do
-- handle_new_user) e movia o profile pra lá. Regra do negócio: conta é o
-- PRODUTO PAGO — quem foi removido não ganha conta. Agora a remoção apenas
-- APAGA o profile do usuário (corta o acesso a QUALQUER dado na hora, via RLS).
-- O bloqueio do login (auth.users.banned_until) + derrubar sessões é feito na
-- camada da app (rota DELETE /api/account/members/[userId]) via service role.
--
-- deals.assigned_to → profiles.id é ON DELETE SET NULL, então apagar o profile
-- é seguro (as atribuições viram nulas, sem quebrar FK).

CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Remoção total: sem conta nova. Apaga o profile → o usuário deixa de ser
  -- membro de qualquer conta e a RLS passa a negar tudo pra ele na hora.
  DELETE FROM profiles WHERE user_id = p_user_id;
  -- Limpa qualquer participação em roster multi-conta (não volta pelo seletor).
  DELETE FROM account_members WHERE user_id = p_user_id;

  RETURN NULL;
END;
$function$;
