-- Auto-avanço de funil — flags OPT-IN por pipeline. Aditiva, default OFF:
-- nenhum tenant muda de comportamento sem ligar explicitamente.
--
--   auto_advance_on_reply: primeira resposta do contato move o negócio da
--     1ª etapa (position mínima) para a 2ª ("conversa ativa"). Consumido
--     pelo webhook de mensagens (src/lib/pipeline/auto-advance.ts).
--   call_booked_stage_id: quando o agente de IA agenda a call
--     (agendar_call), o negócio vai para esta etapa (ex.: "Diagnóstico
--     agendado"). NULL = desligado.
--
-- Histórico de movimento fica no trigger de deal_stage_events (073).

alter table public.pipelines
  add column if not exists auto_advance_on_reply boolean not null default false,
  add column if not exists call_booked_stage_id uuid
    references public.pipeline_stages(id) on delete set null;
