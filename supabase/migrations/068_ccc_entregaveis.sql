-- Central de Comando Comercial — entregáveis gerados por um agente 3R.
-- ============================================================
-- A partir de um ccc_diagnosticos + a transcrição do kickoff, um agente 3R
-- gera diagnóstico + playbook + scripts + régua. O resultado (estruturado +
-- markdown) fica aqui, pronto pra revisão do consultor e uso na instalação.
--
-- Escrita: só service role (a rota /api/diagnostico/gerar).
-- Leitura: membros da conta (quando associado a uma).

CREATE TABLE IF NOT EXISTS public.ccc_entregaveis (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnostico_id uuid REFERENCES public.ccc_diagnosticos(id) ON DELETE CASCADE,
  account_id     uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  entregaveis    jsonb NOT NULL,          -- estrutura completa (diagnostico, playbook, scripts, regua)
  conteudo_md    text,                    -- markdown montado no servidor
  prompt_versao  text,
  uso            jsonb,                   -- telemetria de tokens
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ccc_entregaveis_diagnostico_idx
  ON public.ccc_entregaveis (diagnostico_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ccc_entregaveis_account_idx
  ON public.ccc_entregaveis (account_id, created_at DESC);

ALTER TABLE public.ccc_entregaveis ENABLE ROW LEVEL SECURITY;

CREATE POLICY ccc_entregaveis_select ON public.ccc_entregaveis
  FOR SELECT USING (account_id IS NOT NULL AND public.is_account_member(account_id));

-- Sem policy de INSERT/UPDATE: gravação exclusiva do service role.
