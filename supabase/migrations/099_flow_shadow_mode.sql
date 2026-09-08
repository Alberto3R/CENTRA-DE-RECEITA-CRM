-- ============================================================
-- 099_flow_shadow_mode.sql — ensaio antes da estreia
--
-- Trocar uma régua que já está no ar por um fluxo novo é troca de motor com o
-- carro andando. Em modo sombra o fluxo roda inteiro — entra, espera, chega no
-- nó de envio — e registra em flow_run_events o que TERIA mandado, sem mandar.
-- Uma semana disso ao lado da régua atual mostra se os dois concordam antes de
-- alguém receber mensagem de um caminho não testado.
--
-- Vale para todo nó que fala com o cliente, não só o de modelo: sombra que
-- deixa passar um `send_message` não é sombra.
-- ============================================================

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.flows.shadow_mode IS
  'Fluxo roda sem enviar nada: cada envio vira um evento shadow_send em flow_run_events.';

-- O ensaio precisa deixar rastro com nome próprio: 'shadow_send' é o que
-- teria saído. Reusar 'message_sent' misturaria ensaio com estreia justamente
-- no relatório que serve para comparar os dois.
ALTER TABLE public.flow_run_events
  DROP CONSTRAINT IF EXISTS flow_run_events_event_type_check;
ALTER TABLE public.flow_run_events
  ADD CONSTRAINT flow_run_events_event_type_check
  CHECK (event_type IN (
    'started','node_entered','message_sent','shadow_send','reply_received',
    'fallback_fired','handoff','timeout','error','completed'
  ));
