-- ============================================================
-- 098_flow_wait.sql — o motor de Fluxos aprende a esperar TEMPO
--
-- Até aqui um fluxo só sabia esperar o cliente falar. Toda régua de toques
-- ("manda de novo daqui a 2 dias") teve de virar edge function própria —
-- diag-cadencia, diag-reengajamento, ccc-acompanhamento — cada uma
-- reinventando o controle de estado. Foi exatamente esse controle de estado
-- reinventado que quebrou em 02/set e reenviou a mesma abertura 11× por dia.
--
-- Com `wait` + `resume_at`, a régua vira desenho no editor: quem mexe nos
-- intervalos é o dono do comercial, não um deploy.
-- ============================================================

ALTER TABLE public.flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE public.flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type = ANY (ARRAY[
    'start','send_buttons','send_list','send_message','send_media',
    'collect_input','condition','set_tag','http_fetch',
    'wait','send_template',
    'handoff','end'
  ]));

-- Quando o worker de retomada deve acordar este run. NULL = está esperando
-- o cliente (ou não está esperando nada).
ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS resume_at timestamptz;

-- O worker varre "runs ativos com hora marcada que já venceu", de minuto em
-- minuto. Índice parcial porque a esmagadora maioria dos runs tem resume_at
-- nulo e não interessa a essa varredura.
CREATE INDEX IF NOT EXISTS flow_runs_resume_at_idx
  ON public.flow_runs(resume_at)
  WHERE status = 'active' AND resume_at IS NOT NULL;

-- Numa cadência, a resposta do lead ENCERRA a régua e passa a bola para o
-- humano/IA — o inverso do fluxo conversacional, onde a resposta é o que faz
-- o run avançar. Default false para não mudar nenhum fluxo existente.
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS stop_on_reply boolean NOT NULL DEFAULT false;

-- Worker de retomada: mesma mecânica do dreno de disparos (segredo em
-- app_config, não em env var).
SELECT cron.schedule(
  'flows-resume',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://sales-3r-crm.vercel.app/api/flows/resume/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'broadcast_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $cron$
);
