-- ============================================================
-- 095_corte_de_acesso_no_prazo.sql — o prazo do aviso passa a cortar
--
-- A migração 094 criou o AVISO (accounts.access_suspends_at + contagem
-- regressiva no topo). Aqui o prazo vira corte de verdade: vencido o
-- prazo, a conta perde acesso aos dados.
--
-- O corte é feito no ÚNICO ponto por onde passa o RLS do produto
-- inteiro: `is_account_member()`, usada por 141 policies em 65 tabelas.
-- Mexer nela pega tudo de uma vez — inbox, contatos, funis, disparos,
-- relatórios — em vez de 141 edições que envelhecem mal.
--
-- Três coisas ficam DE FORA do corte, de propósito:
--
--   1. `accounts` (SELECT) — a tela de conta suspensa, o banner e o
--      `getCurrentAccount()` precisam ler a própria conta para saber que
--      estão suspensos e mostrar a data. Sem isso o app não consegue
--      nem explicar por que parou. Por isso a policy passa a usar
--      `is_account_member_raw()`, sem o corte.
--   2. `profiles` (SELECT do próprio usuário) — já era `auth.uid() =
--      user_id`, não passa por `is_account_member`. O login continua
--      funcionando; ele só não enxerga mais dado nenhum do tenant.
--   3. Impersonation de platform admin — a Sales 3R tem que conseguir
--      entrar na conta suspensa para inspecionar e resolver.
--
-- Service role (webhooks, workers, pg_cron) ignora RLS: as mensagens
-- que chegam continuam sendo gravadas enquanto a conta está suspensa.
-- Suspensão é perda de ACESSO, não perda de dado.
--
-- Para religar: zerar `access_suspends_at` (o webhook do Stripe já faz
-- isso quando a assinatura volta a ficar ativa).
-- ============================================================

-- Vencido? Escrita defensiva de propósito: só devolve true com uma data
-- explícita no passado. Sem prazo, conta inexistente ou NULL → false.
-- Esta função entra no caminho crítico de TODA policy do produto; o
-- lado seguro do erro é "não suspenso".
CREATE OR REPLACE FUNCTION public.is_account_suspended(target_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT a.access_suspends_at <= now()
       FROM accounts a
      WHERE a.id = target_account_id),
    false
  );
$$;

COMMENT ON FUNCTION public.is_account_suspended(uuid) IS
  'true quando o prazo de suspensão da conta já venceu. Usada por is_account_member para cortar o acesso.';

-- O teste de participação SEM o corte. Existe para os poucos casos em
-- que a conta suspensa ainda precisa ser lida (ver accounts_select).
CREATE OR REPLACE FUNCTION public.is_account_member_raw(
  target_account_id uuid,
  min_role account_role_enum DEFAULT 'viewer'::account_role_enum
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  )
  OR (
    min_role = 'viewer'
    AND target_account_id = current_impersonation()
  );
$$;

COMMENT ON FUNCTION public.is_account_member_raw(uuid, account_role_enum) IS
  'Participação na conta SEM o corte por suspensão. Use is_account_member() salvo quando a conta suspensa precisar mesmo enxergar a linha.';

-- O gate de sempre, agora com o corte. A participação por perfil passa
-- a exigir conta não suspensa; o ramo de impersonation continua aberto
-- para o platform admin poder entrar e resolver.
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum DEFAULT 'viewer'::account_role_enum
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (
    EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = target_account_id
        AND CASE p.account_role
              WHEN 'owner'  THEN 4
              WHEN 'admin'  THEN 3
              WHEN 'agent'  THEN 2
              WHEN 'viewer' THEN 1
            END
          >=
            CASE min_role
              WHEN 'owner'  THEN 4
              WHEN 'admin'  THEN 3
              WHEN 'agent'  THEN 2
              WHEN 'viewer' THEN 1
            END
    )
    AND NOT public.is_account_suspended(target_account_id)
  )
  OR (
    min_role = 'viewer'
    AND target_account_id = current_impersonation()
  );
$$;

COMMENT ON FUNCTION public.is_account_member(uuid, account_role_enum) IS
  'Participação na conta + conta não suspensa. Gate de RLS do produto inteiro.';

-- A conta suspensa continua lendo a PRÓPRIA linha de accounts — é o que
-- permite a tela /suspenso dizer desde quando e por quê. Sem isto o
-- getCurrentAccount() falha e o usuário cai numa tela errada.
DROP POLICY IF EXISTS accounts_select ON public.accounts;
CREATE POLICY accounts_select ON public.accounts
  FOR SELECT USING (public.is_account_member_raw(id));

-- accounts_update segue em is_account_member (com corte): conta
-- suspensa não edita a própria conta.
