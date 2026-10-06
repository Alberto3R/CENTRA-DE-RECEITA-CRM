-- ============================================================
-- 105_etapa_toques.sql — a régua de contato de cada etapa
--
-- pipeline_stages.toques: lista de { dia, canal, acao, mensagem } — o que o
-- vendedor faz em cada dia que o negócio passa na etapa (dia 0 = o dia em
-- que entrou). O card mostra o toque do dia e o motor de cadência da CCC
-- cobra o vendedor por ela. Funis existentes ficam com lista vazia — os
-- modelos da biblioteca já vêm com a régua pronta.
-- ============================================================

alter table public.pipeline_stages
  add column if not exists toques jsonb not null default '[]'::jsonb
  check (jsonb_typeof(toques) = 'array');
