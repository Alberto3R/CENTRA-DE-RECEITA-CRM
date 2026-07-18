-- Central de Comando Comercial — config do agente 3R de acompanhamento (fase 4b).
-- ============================================================
-- Por conta: pra quem mandar o resumo (gestor_whatsapp), o limiar de "parado"
-- e o liga/desliga. `ativo` começa FALSE de propósito — nenhuma conta recebe
-- WhatsApp até ser ativada explicitamente (o cron varre só as ativas).
-- Também cria o segredo do cron (padrão da migration 055: segredo no banco).

CREATE TABLE IF NOT EXISTS public.ccc_acompanhamento_config (
  account_id      uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  gestor_whatsapp text,                              -- número que recebe o resumo (formato 55DDDNUMERO)
  dias_parado     integer NOT NULL DEFAULT 5,
  ativo           boolean NOT NULL DEFAULT false,    -- opt-in: só envia quando true
  ultimo_envio_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ccc_acompanhamento_config ENABLE ROW LEVEL SECURITY;

-- Leitura: membros da conta. Escrita: service role (config feita pela 3R).
CREATE POLICY ccc_acomp_config_select ON public.ccc_acompanhamento_config
  FOR SELECT USING (public.is_account_member(account_id));

-- Segredo do cron do acompanhamento (compartilhado banco↔endpoint, como no 055).
INSERT INTO public.app_config (key, value)
VALUES ('ccc_cron_secret', encode(gen_random_bytes(24), 'hex'))
ON CONFLICT (key) DO NOTHING;
