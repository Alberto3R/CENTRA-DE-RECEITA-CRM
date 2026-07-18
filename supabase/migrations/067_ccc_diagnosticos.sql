-- Central de Comando Comercial — respostas do Formulário de Diagnóstico.
-- ============================================================
-- O cliente (potencial ou já fechado) responde o diagnóstico no /diagnostico.
-- As respostas caem aqui e depois um agente 3R junta com a transcrição do
-- kickoff pra gerar o diagnóstico + playbook + scripts.
--
-- Escrita: só o service role (a rota /api/diagnostico); o form é público, sem sessão.
-- Leitura: membros da conta (quando já associado a uma). Avulsos (account_id
--          nulo, fase de venda) só pelo backend/agente via service role.

CREATE TABLE IF NOT EXISTS public.ccc_diagnosticos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid REFERENCES public.accounts(id) ON DELETE CASCADE,   -- nullable: diagnóstico pode vir antes da conta existir
  nome        text NOT NULL,
  empresa     text,
  whatsapp    text NOT NULL,
  respostas   jsonb NOT NULL DEFAULT '{}'::jsonb,
  origem      text NOT NULL DEFAULT 'formulario-web',
  status      text NOT NULL DEFAULT 'novo',                            -- novo | processado
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ccc_diagnosticos_account_idx
  ON public.ccc_diagnosticos (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ccc_diagnosticos_status_idx
  ON public.ccc_diagnosticos (status, created_at DESC);

ALTER TABLE public.ccc_diagnosticos ENABLE ROW LEVEL SECURITY;

-- Leitura: membros da conta (is_account_member já existe — migration 017).
-- Diagnósticos avulsos (account_id nulo) não são visíveis por membros; só service role.
CREATE POLICY ccc_diagnosticos_select ON public.ccc_diagnosticos
  FOR SELECT USING (account_id IS NOT NULL AND public.is_account_member(account_id));

-- Sem policy de INSERT/UPDATE: gravação exclusiva do service role (rota /api/diagnostico).
