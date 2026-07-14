-- Onboarding Stripe-first: LOGIN não é CONTA.
-- ============================================================
-- Regra do negócio: a CONTA é o produto pago. Só ganha conta quem COMPROU
-- (webhook do Stripe provisiona) ou foi CONVIDADO (redeem cria o profile).
-- Criar um login (auth.signUp) passa a NÃO dar mais conta/profile de brinde.
--
-- Modelo: um usuário autenticado SEM profile = sem conta = sem acesso ao CRM
-- (getCurrentAccount já lança ForbiddenError; o app manda pra /comecar). O
-- profile só nasce quando a conta é provisionada (compra) ou anexada (convite).
--
-- Três mudanças:
--   1. handle_new_user() vira no-op  → signup não cria conta nem profile.
--   2. provision_account(user, name) → cria conta+profile owner no pagamento.
--   3. redeem_invitation()           → passa a CRIAR o profile do convidado
--                                       (antes movia um profile pré-existente).

-- ------------------------------------------------------------
-- 1. handle_new_user: no-op. Sem conta grátis no signup.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Login não é conta. A conta (com profile owner) é criada só na COMPRA
  -- (provision_account) ou no CONVITE (redeem_invitation). Signup avulso deixa
  -- apenas o auth.users — sem profile, sem acesso a nada até comprar/ser convidado.
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- 2. provision_account: cria conta + profile owner para um comprador.
--    Chamada pelo webhook do Stripe (service role) após o pagamento.
--    Idempotente: se o usuário já tem profile/conta, devolve a conta atual.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_account(p_user_id uuid, p_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_account_id UUID;
  v_email TEXT;
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;

  -- Já tem conta? Devolve a existente (retry de webhook, upgrade, etc.).
  SELECT account_id INTO v_existing_account_id
  FROM profiles WHERE user_id = p_user_id;
  IF v_existing_account_id IS NOT NULL THEN
    RETURN v_existing_account_id;
  END IF;

  SELECT email, COALESCE(raw_user_meta_data->>'full_name', '')
  INTO v_email, v_full_name
  FROM auth.users WHERE id = p_user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Auth user % not found', p_user_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(p_name, ''), NULLIF(v_full_name, ''), v_email, 'Minha conta'), p_user_id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (p_user_id, v_full_name, v_email, v_account_id, 'owner');

  RETURN v_account_id;
END;
$function$;

-- ------------------------------------------------------------
-- 3. redeem_invitation: agora CRIA o profile do convidado (que não tem mais
--    conta de brinde). Mantém o caminho legado (usuário com conta própria
--    vazia → move e apaga) por segurança para bases antigas.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
  v_email TEXT;
  v_full_name TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  -- CAMINHO NOVO: convidado sem profile (login puro). Cria o profile já dentro
  -- da conta do convite. Nada de conta pessoal.
  IF v_old_account_id IS NULL THEN
    SELECT email, COALESCE(raw_user_meta_data->>'full_name', '')
    INTO v_email, v_full_name
    FROM auth.users WHERE id = v_caller_id;

    INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role, funcao)
    VALUES (v_caller_id, v_full_name, v_email, v_inv.account_id, v_inv.role, v_inv.funcao);

    UPDATE account_invitations
    SET accepted_at = NOW(), accepted_by_user_id = v_caller_id
    WHERE id = v_inv.id;

    RETURN v_inv.account_id;
  END IF;

  -- CAMINHO LEGADO: usuário que ainda tem uma conta própria (bases antigas).
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role,
      funcao = v_inv.funcao
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$function$;
