-- ============================================================
-- 092 — Notas do negócio: múltiplas, com título
--
-- Antes: `deals.notes` era uma coluna `text` única. Todo mundo escrevia
-- no mesmo bloco — resultado de formulário, qualificação do SDR, anotação
-- solta — e apagar a parte errada destruía o resto.
--
-- Depois:
--   deal_notes  = FONTE DA VERDADE (múltiplas notas, com título)
--        │
--        └── trigger ──> deals.notes = ESPELHO derivado
--
-- O espelho é o que torna a migração segura: tudo que lê a coluna hoje
-- continua funcionando sem uma linha de alteração — diag-relatorio
-- (painel /leads), diag-cadencia, diagnostico-intake, diag-pdf,
-- leadgen-import e o webhook de gateway.
--
-- E escritas legadas direto em `deals.notes` são CAPTURADAS e viram nota,
-- então nenhuma edge function precisou ser tocada para não perder dado.
-- ============================================================

create table if not exists public.deal_notes (
  id             uuid primary key default uuid_generate_v4(),
  deal_id        uuid not null references public.deals(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  title          text not null,
  body           text not null default '',
  kind           text not null default 'manual',  -- diagnostico | qualificacao_sdr | importada | manual
  author_user_id uuid,
  position       int  not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists deal_notes_deal_idx    on public.deal_notes(deal_id, position, created_at);
create index if not exists deal_notes_account_idx on public.deal_notes(account_id);

-- Só pode existir UMA nota de cada tipo automático por negócio.
-- É o que garante idempotência dos gatilhos que criam nota sozinhos.
create unique index if not exists deal_notes_deal_kind_uniq
  on public.deal_notes(deal_id, kind)
  where kind in ('diagnostico','qualificacao_sdr','importada');

alter table public.deal_notes enable row level security;

drop policy if exists dn_select on public.deal_notes;
drop policy if exists dn_insert on public.deal_notes;
drop policy if exists dn_update on public.deal_notes;
drop policy if exists dn_delete on public.deal_notes;

-- Mesma régua de tenancy de `deals` (migration 017 em diante).
create policy dn_select on public.deal_notes for select
  using (is_account_member(account_id));
create policy dn_insert on public.deal_notes for insert
  with check (is_account_member(account_id, 'agent'::account_role_enum));
create policy dn_update on public.deal_notes for update
  using (is_account_member(account_id, 'agent'::account_role_enum));
create policy dn_delete on public.deal_notes for delete
  using (is_account_member(account_id, 'agent'::account_role_enum));

-- ------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------
create or replace function public.deal_notes_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_deal_notes_touch on public.deal_notes;
create trigger trg_deal_notes_touch before update on public.deal_notes
for each row execute function public.deal_notes_touch();

-- ------------------------------------------------------------
-- ESPELHO: deal_notes -> deals.notes
--
-- Formato: "=== TÍTULO ===\n<corpo>", blocos separados por linha em branco.
-- Todo parser existente usa match por substring (verificado no
-- diag-relatorio), então o cabeçalho não quebra nada; e o regex de
-- `Respostas:` fica preso a uma linha, então não vaza pra nota seguinte.
-- ------------------------------------------------------------
create or replace function public.deal_notes_mirror()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deal uuid := coalesce(new.deal_id, old.deal_id);
  v_txt  text;
begin
  select string_agg('=== ' || upper(n.title) || ' ===' || E'\n' || n.body,
                    E'\n\n' order by n.position, n.created_at)
    into v_txt
    from deal_notes n
   where n.deal_id = v_deal;

  perform set_config('app.mirroring', '1', true);
  update deals set notes = coalesce(v_txt, '') where id = v_deal;
  perform set_config('app.mirroring', '0', true);
  return null;
end $$;

drop trigger if exists trg_deal_notes_mirror on public.deal_notes;
create trigger trg_deal_notes_mirror
after insert or update or delete on public.deal_notes
for each row execute function public.deal_notes_mirror();

-- ------------------------------------------------------------
-- CAPTURA: escrita legada em deals.notes -> vira nota
--
-- Anti-laço: o espelho marca `app.mirroring` (local à transação) antes de
-- gravar em `deals`; a captura vê a flag e não recaptura.
-- ------------------------------------------------------------
create or replace function public.deals_notes_capture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind  text;
  v_title text;
  v_pos   int;
  v_txt   text := coalesce(new.notes, '');
begin
  if coalesce(current_setting('app.mirroring', true), '0') = '1' then
    return null;                       -- veio do espelho
  end if;
  if tg_op = 'UPDATE' and coalesce(old.notes,'') = v_txt then
    return null;                       -- notes não mudou
  end if;
  if btrim(v_txt) = '' then
    return null;
  end if;
  if v_txt like '=== %' then
    return null;                       -- já é o texto espelhado
  end if;

  if v_txt like '%Respostas:%' and v_txt like '%Índice:%' then
    v_kind := 'diagnostico'; v_title := 'Diagnóstico'; v_pos := 0;
  else
    v_kind := 'importada';   v_title := 'Nota importada'; v_pos := 90;
  end if;

  insert into deal_notes (deal_id, account_id, title, body, kind, position)
  values (new.id, new.account_id, v_title, v_txt, v_kind, v_pos)
  on conflict (deal_id, kind) where kind in ('diagnostico','qualificacao_sdr','importada')
  do update set body = excluded.body, updated_at = now();

  return null;
exception when others then
  raise warning 'deals_notes_capture falhou no deal %: %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_deals_notes_capture on public.deals;
create trigger trg_deals_notes_capture
after insert or update of notes on public.deals
for each row execute function public.deals_notes_capture();

comment on table public.deal_notes is
  'Notas do negócio (múltiplas, com título). Fonte da verdade; deals.notes é espelho derivado mantido por trigger para compatibilidade com os leitores antigos.';

-- ------------------------------------------------------------
-- BACKFILL — cada `deals.notes` existente vira uma nota
-- ------------------------------------------------------------
insert into deal_notes (deal_id, account_id, title, body, kind, position)
select d.id, d.account_id,
       case when d.notes like '%Respostas:%' and d.notes like '%Índice:%'
            then 'Diagnóstico' else 'Nota importada' end,
       d.notes,
       case when d.notes like '%Respostas:%' and d.notes like '%Índice:%'
            then 'diagnostico' else 'importada' end,
       case when d.notes like '%Respostas:%' and d.notes like '%Índice:%'
            then 0 else 90 end
  from deals d
 where coalesce(d.notes,'') <> ''
   and d.notes not like '=== %'
   and not exists (select 1 from deal_notes n where n.deal_id = d.id);
