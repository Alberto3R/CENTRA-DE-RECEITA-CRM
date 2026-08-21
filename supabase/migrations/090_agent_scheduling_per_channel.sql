-- Ferramentas de agenda por CANAL, não por conta.
--
-- O gate das tools `ver_horarios`/`agendar_call` olhava só scheduling_config,
-- que é por account_id. Numa conta com mais de um agente (multi-canal), isso
-- entrega a agenda comercial para TODOS os canais — inclusive os que não têm
-- nada a ver com marcar reunião.
--
-- Caso real (AUGRA, 21/ago/2026): o canal de recrutamento respondeu a um
-- candidato com horários da agenda de vendas e negou a data do convite oficial
-- que a própria empresa tinha mandado minutos antes. O bloco que o sistema
-- anexa ao prompt ("Você PODE marcar a call sozinho") entrava depois das
-- instruções do agente e vencia a disputa.
--
-- Desligar scheduling_config resolveria o canal errado e quebraria os canais de
-- prospecção, que dependem da agenda para vender. Daí a flag por canal.
alter table public.ai_agent_config
  add column if not exists scheduling_enabled boolean not null default true;

comment on column public.ai_agent_config.scheduling_enabled is
  'Quando false, o agente deste canal não recebe as ferramentas de agenda nem o bloco de prompt de agendamento. Default true preserva o comportamento atual.';
