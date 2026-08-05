-- ============================================================
-- Painel de plataforma: super admin + impersonation SOMENTE-LEITURA
--
-- O que é preciso: suporte precisa ver o que o cliente está vendo,
-- sem que isso vire um caminho de vazamento entre tenants.
--
-- A decisão de desenho que sustenta tudo:
--   a permissão de impersonar NÃO é um booleano no perfil, nem um
--   claim dentro de um token. É UMA LINHA NESTA TABELA, com prazo.
--
-- Consequências, todas desejáveis:
--   * é impossível impersonar sem deixar registro — o registro É a
--     permissão, não um efeito colateral que alguém pode esquecer
--     de gravar;
--   * revogar é instantâneo (UPDATE ... ended_at = now()), sem
--     deploy e sem esperar token expirar;
--   * expira sozinho, pelo relógio do banco;
--   * não há segredo novo para vazar (assinar JWT próprio exigiria
--     manusear o segredo do Supabase).
--
-- E a garantia mais importante — SOMENTE-LEITURA IMPOSTA PELO BANCO:
--   as policies deste schema seguem, sem exceção, o padrão
--     SELECT                → is_account_member(account_id)   [viewer]
--     INSERT/UPDATE/DELETE  → is_account_member(account_id, 'agent'|'admin')
--   Então uma cláusula de impersonation que só vale quando
--   min_role = 'viewer' concede leitura e é FALSE para toda escrita.
--   Não é convenção que o código precisa respeitar: é o Postgres
--   recusando. Um bug no painel, ou uma rota nova mal-escrita, não
--   consegue escrever no tenant impersonado.
--
--   O invariante que isso exige (nenhuma policy de escrita usando o
--   min_role default) é verificado em CI por
--   `src/lib/auth/policy-invariant.test.ts`, lendo estes arquivos.
--
-- Idempotente — seguro re-rodar.
-- ============================================================

-- ============================================================
-- 1. QUEM É PLATAFORMA
--
-- Tabela dedicada em vez de reaproveitar `profiles.role` (que a 017
-- marcou como legado a remover): o poder de atravessar tenants merece
-- um lugar explícito, auditável e fácil de revisar por completo com
-- um SELECT.
--
-- RLS habilitado e ZERO policies: com RLS ligado e nenhuma policy, o
-- papel `authenticated` não lê nem escreve nada aqui. A tabela só é
-- alcançável pelo console SQL ou por service role. Ninguém se
-- autopromove pela API — nem com um bug de rota.
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE platform_admins IS
  'Quem pode abrir sessão de impersonation. RLS ligado sem nenhuma policy = inalcançável pela API; conceder/revogar só por console SQL. Remover alguém daqui encerra as sessões ativas dele na hora (ver current_impersonation).';

-- ============================================================
-- 2. SESSÕES DE IMPERSONATION
--
-- `reason` com tamanho mínimo é deliberado: obriga a escrever algo
-- útil no log ("chamado #482 - cliente não recebe mensagens") em vez
-- de "teste". O log só vale se for legível meses depois.
--
-- Também sem policies: o painel lê e escreve por service role, em
-- rotas que verificam platform_admins antes. Nenhum usuário comum
-- enxerga esta tabela.
-- ============================================================
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason            TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,
  CONSTRAINT impersonation_sessions_expires_after_start
    CHECK (expires_at > started_at)
);

ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- Consulta quente: "existe sessão ativa para este ator?" roda em toda
-- avaliação de policy, então precisa ser um index lookup.
CREATE INDEX IF NOT EXISTS idx_impersonation_active
  ON impersonation_sessions (actor_user_id, expires_at DESC)
  WHERE ended_at IS NULL;

-- Para a auditoria pelo lado do cliente: "quem entrou na minha conta?"
CREATE INDEX IF NOT EXISTS idx_impersonation_by_target
  ON impersonation_sessions (target_account_id, started_at DESC);

COMMENT ON TABLE impersonation_sessions IS
  'Append-only. Cada linha É a permissão de impersonar um tenant, com prazo. Encerrar = preencher ended_at (único UPDATE permitido). DELETE bloqueado por trigger.';

-- ============================================================
-- 3. APPEND-ONLY DE VERDADE
--
-- Sem isto, um audit log é só uma tabela que alguém com service role
-- pode reescrever depois do incidente. O trigger permite exatamente
-- uma transição — cravar `ended_at` uma vez — e nada mais. Vale
-- inclusive para service role, que é o ponto: o log tem que resistir
-- a quem opera o sistema.
-- ============================================================
CREATE OR REPLACE FUNCTION impersonation_sessions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'impersonation_sessions é append-only: DELETE não é permitido';
  END IF;

  -- Só `ended_at` muda, e só de NULL para um valor.
  IF NEW.id                IS DISTINCT FROM OLD.id
     OR NEW.actor_user_id     IS DISTINCT FROM OLD.actor_user_id
     OR NEW.target_account_id IS DISTINCT FROM OLD.target_account_id
     OR NEW.reason            IS DISTINCT FROM OLD.reason
     OR NEW.started_at        IS DISTINCT FROM OLD.started_at
     OR NEW.expires_at        IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'impersonation_sessions é append-only: só ended_at pode mudar';
  END IF;

  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'impersonation_sessions: ended_at já está definido e não pode ser alterado';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_impersonation_sessions_append_only ON impersonation_sessions;
CREATE TRIGGER trg_impersonation_sessions_append_only
  BEFORE UPDATE OR DELETE ON impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION impersonation_sessions_append_only();

-- ============================================================
-- 4. QUAL TENANT ESTÁ SENDO IMPERSONADO AGORA
--
-- Retorna NULL quando não há sessão ativa. Isso importa: a cláusula
-- em is_account_member compara `target_account_id = current_impersonation()`,
-- e comparação com NULL é NULL, não TRUE. FALHA FECHADO por construção
-- — não por um `IF` que alguém pode inverter sem querer.
--
-- O JOIN com platform_admins é o kill switch: revogar o admin derruba
-- as sessões ativas dele na mesma hora, sem precisar encerrá-las uma
-- a uma.
--
-- SECURITY DEFINER porque roda de dentro das policies e precisa ler
-- tabelas que o chamador não enxerga.
-- ============================================================
CREATE OR REPLACE FUNCTION current_impersonation()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.target_account_id
  FROM impersonation_sessions s
  JOIN platform_admins pa ON pa.user_id = s.actor_user_id
  WHERE s.actor_user_id = auth.uid()
    AND s.ended_at IS NULL
    AND s.expires_at > now()
  ORDER BY s.started_at DESC
  LIMIT 1
$$;

ALTER FUNCTION current_impersonation() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION current_impersonation() TO authenticated, service_role;

COMMENT ON FUNCTION current_impersonation() IS
  'account_id do tenant que o chamador está impersonando agora, ou NULL. Usada por is_account_member para conceder LEITURA (nunca escrita) sobre esse tenant.';

-- ============================================================
-- 5. A CLÁUSULA
--
-- Substitui is_account_member preservando a checagem de membro
-- palavra por palavra (ver 017) e acrescentando um único OR.
--
-- `min_role = 'viewer'` é o que trava a escrita. Toda policy de
-- INSERT/UPDATE/DELETE deste schema passa 'agent' ou 'admin', então
-- para elas esta cláusula é FALSE e o Postgres nega. Só as de SELECT,
-- que usam o default 'viewer', passam.
--
-- Se um dia existir impersonation com escrita, ela NÃO deve nascer
-- afrouxando isto: o certo é uma coluna `write_enabled` na sessão e
-- uma segunda cláusula explícita, para o caso permissivo continuar
-- sendo o caso raro e visível.
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

COMMENT ON FUNCTION is_account_member(UUID, account_role_enum) IS
  'Membro do tenant com pelo menos min_role, OU platform admin com sessão de impersonation ativa neste tenant — neste segundo caso apenas para leitura (min_role = viewer).';

-- ============================================================
-- 6. VISÃO GERAL DOS TENANTS
--
-- A lista do painel. Existe como função agregada — e não como um
-- punhado de queries no servidor — por dois motivos: PostgREST não faz
-- GROUP BY sem view/RPC, e contar por tenant em laço seria uma query
-- por conta.
--
-- EXECUTE só para service_role. Um usuário autenticado que descobrisse
-- o nome desta função não conseguiria chamá-la: ela lista TODOS os
-- tenants, então não pode ser alcançável pela API do cliente.
--
-- `messages` não tem account_id (é filha de conversations), então a
-- atividade é medida por conversations.last_message_at, que já é
-- mantida atualizada pelo webhook.
-- ============================================================
CREATE OR REPLACE FUNCTION platform_tenant_overview()
RETURNS TABLE (
  account_id         UUID,
  account_name       TEXT,
  created_at         TIMESTAMPTZ,
  member_count       BIGINT,
  contact_count      BIGINT,
  conversation_count BIGINT,
  unread_total       BIGINT,
  channel_count      BIGINT,
  connected_channels BIGINT,
  last_message_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    a.created_at,
    (SELECT count(*) FROM profiles p WHERE p.account_id = a.id),
    (SELECT count(*) FROM contacts c WHERE c.account_id = a.id),
    (SELECT count(*) FROM conversations cv WHERE cv.account_id = a.id),
    (SELECT coalesce(sum(cv.unread_count), 0) FROM conversations cv WHERE cv.account_id = a.id),
    (SELECT count(*) FROM whatsapp_config w WHERE w.account_id = a.id),
    (SELECT count(*) FROM whatsapp_config w WHERE w.account_id = a.id AND w.status = 'connected'),
    (SELECT max(cv.last_message_at) FROM conversations cv WHERE cv.account_id = a.id)
  FROM accounts a
  ORDER BY a.created_at DESC
$$;

ALTER FUNCTION platform_tenant_overview() OWNER TO postgres;
REVOKE ALL ON FUNCTION platform_tenant_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_tenant_overview() FROM authenticated;
GRANT EXECUTE ON FUNCTION platform_tenant_overview() TO service_role;

COMMENT ON FUNCTION platform_tenant_overview() IS
  'Métricas por tenant para o painel de plataforma. Atravessa todos os tenants, por isso EXECUTE é exclusivo de service_role.';
