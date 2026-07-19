-- Central de Comando Comercial — status de revisão dos entregáveis.
-- O consultor 3R passa a poder EDITAR o texto e APROVAR o pacote antes do
-- go-live (a tela /ccc/revisar deixa de ser só leitura). Aditiva e isolada.

alter table public.ccc_entregaveis
  add column if not exists status text not null default 'rascunho',
  add column if not exists aprovado_em timestamptz;

-- só aceita os dois estados de revisão
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ccc_entregaveis_status_check'
  ) then
    alter table public.ccc_entregaveis
      add constraint ccc_entregaveis_status_check
      check (status in ('rascunho', 'aprovado'));
  end if;
end $$;

comment on column public.ccc_entregaveis.status is 'rascunho | aprovado — controle de revisão do consultor 3R';
comment on column public.ccc_entregaveis.aprovado_em is 'quando o consultor aprovou o pacote (null enquanto rascunho)';
