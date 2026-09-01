-- ============================================================
-- 093 — Automações da SDR (ESPECÍFICAS DA CONTA SALES 3R)
--
-- ⚠️ Diferente das outras migrations, esta NÃO é genérica de produto:
-- ela tem UUIDs fixos da conta Sales 3R (conta, canal, etapa, usuário).
-- Está aqui porque os gatilhos já rodam em produção e ficar fora do
-- controle de versão é pior do que o acoplamento — mas os dois gatilhos
-- saem cedo (`return null`) em qualquer outra conta, então nenhum outro
-- tenant é afetado.
--
-- Se preferir manter o repo 100% genérico, este arquivo pode ser
-- removido do PR sem impacto no que já está aplicado no banco.
--
-- Contém:
--   1. notificar_sdr_novo_lead  — avisa a SDR no WhatsApp a cada lead novo
--   2. inserir_dossie_handoff   — cria a nota "Qualificação SDR"
--                                 pré-preenchida ao agendar o Raio-X
-- ============================================================

-- ------------------------------------------------------------
-- 1. Aviso à SDR quando entra lead novo
--
-- Reusa a máquina de broadcast existente: enfileira um broadcast
-- 'scheduled' + 1 destinatário 'pending' e o worker (pg_cron, 1x/min)
-- envia. Sem função nova, sem cron novo.
-- Destinatário vem de app_config('sdr_notify_contact_id') — trocar de
-- SDR ou de número é UPDATE, não migration.
-- ------------------------------------------------------------
create or replace function public.notificar_sdr_novo_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_account  uuid := 'fd9b374f-e140-4bd4-8200-f8663fb09705';  -- Sales 3R
  v_channel  uuid := '1c5d1f80-a6b3-43a8-8955-2a77770be89a';  -- WhatsApp
  v_user     uuid := 'b5180f1b-fc91-48ae-9fcd-48bcbdcdb75b';
  v_tpl      text := 'sdr_novo_lead';
  v_sdr_id   uuid;
  v_sdr_nome text;
  v_lead     text;
  v_indice   text;
  v_vaz      text;
  v_resumo   text;
  v_bid      uuid;
begin
  if new.account_id is distinct from v_account then
    return new;
  end if;

  -- só com o template APROVADO na Meta, senão o envio falharia
  if not exists (
    select 1 from message_templates
     where name = v_tpl and account_id = v_account and status = 'APPROVED'
  ) then
    return new;
  end if;

  select nullif(value,'')::uuid into v_sdr_id
    from app_config where key = 'sdr_notify_contact_id';
  if v_sdr_id is null then
    return new;
  end if;

  select coalesce(nullif(split_part(trim(name),' ',1),''),'')
    into v_sdr_nome
    from contacts
   where id = v_sdr_id and account_id = v_account;
  if not found then
    return new;
  end if;

  if new.contact_id = v_sdr_id then
    return new;                          -- nunca avisar sobre ela mesma
  end if;

  -- trava anti-enxurrada: protege de importação em massa virar spam
  if (select count(*) from broadcasts
       where account_id = v_account
         and name like 'Aviso SDR%'
         and created_at > now() - interval '1 hour') >= 20 then
    return new;
  end if;

  select coalesce(nullif(trim(c.name),''), 'sem nome')
    into v_lead
    from contacts c where c.id = new.contact_id;
  v_lead := coalesce(v_lead, 'sem nome');

  v_indice := substring(coalesce(new.notes,'') from 'Índice: ([0-9]+)/100');
  v_vaz    := substring(coalesce(new.notes,'') from 'Vazamento estimado[^0-9]+([0-9.]+)');

  if v_indice is not null then
    v_resumo := 'Índice ' || v_indice || '/100'
             || coalesce(' · vazamento R$ ' || v_vaz || '/mês', '');
  else
    v_resumo := 'Ainda sem diagnóstico — confere a origem no CRM.';
  end if;

  insert into broadcasts
    (user_id, account_id, channel_id, name, template_name, template_language,
     template_variables, status, scheduled_at, total_recipients)
  values
    (v_user, v_account, v_channel,
     'Aviso SDR · novo lead · ' || left(v_lead, 40) || ' · ' || new.id,
     v_tpl, 'pt_BR',
     jsonb_build_object(
       '1', jsonb_build_object('type','static','value', coalesce(nullif(v_sdr_nome,''),'Ana')),
       '2', jsonb_build_object('type','static','value', left(v_lead, 60)),
       '3', jsonb_build_object('type','static','value', v_resumo)),
     'scheduled', now(), 1)
  returning id into v_bid;

  insert into broadcast_recipients (broadcast_id, contact_id, status)
  values (v_bid, v_sdr_id, 'pending');

  return new;

exception when others then
  -- o aviso é acessório: nunca pode impedir a criação do lead
  raise warning 'notificar_sdr_novo_lead falhou para deal %: %', new.id, sqlerrm;
  return new;
end;
$fn$;

drop trigger if exists trg_notificar_sdr_novo_lead on public.deals;
create trigger trg_notificar_sdr_novo_lead
after insert on public.deals
for each row execute function public.notificar_sdr_novo_lead();

-- ------------------------------------------------------------
-- 2. Dossiê de passagem SDR -> closer
--
-- Ao entrar em "Raio-X agendado", cria a nota "Qualificação SDR" já
-- pré-preenchida com o que o CRM sabe (diagnóstico, vazamento, buracos,
-- faturamento). A SDR só preenche o que veio da conversa.
-- Idempotência vem do índice único (deal_id, kind) da migration 092.
-- ------------------------------------------------------------
create or replace function public.inserir_dossie_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_stage_raiox uuid := 'b00c4123-32e5-4849-845f-613b23c01e49';  -- Raio-X agendado
  diag text;
  v_ind text; v_vaz text; v_bur text; v_resp jsonb;
  v_fat text; v_vend text; v_leads text;
  v_body text;
begin
  if new.stage_id is distinct from v_stage_raiox then return null; end if;
  if old.stage_id is not distinct from new.stage_id then return null; end if;

  if exists (select 1 from deal_notes
              where deal_id = new.id and kind = 'qualificacao_sdr') then
    return null;
  end if;

  select body into diag from deal_notes
   where deal_id = new.id and kind = 'diagnostico' limit 1;
  diag := coalesce(diag, coalesce(new.notes,''));

  v_ind := substring(diag from 'Índice: ([0-9]+/100[^\n]*)');
  v_vaz := substring(diag from 'Vazamento estimado[^0-9]*([0-9.]+[^\n]*)');
  v_bur := substring(diag from 'Maiores buracos: ([^\n]+)');
  begin
    v_resp := (substring(diag from 'Respostas: (\{[^}]*\})'))::jsonb;
  exception when others then v_resp := null; end;

  v_fat   := coalesce(v_resp->>'fat',   '—');
  v_vend  := coalesce(v_resp->>'vend',  '—');
  v_leads := coalesce(v_resp->>'leads', '—');

  v_body :=
E'Preencher AGORA, no calor da conversa. O closer le isso 2 min antes da call.\n'
|| E'\n[ 0 · O COMBINADO ]\n'
|| E'Quem estara na call: \n'
|| E'Cargo / e decisor?  [ sim / nao - se nao, quem e: ______ ]\n'
|| E'Quando:  __/__ as __:__        Canal: [ Meet / ligacao / presencial ]\n'
|| E'\n[ 1 · JA VEIO DO DIAGNOSTICO - so CONFIRA ]\n'
|| E'Diagnostico: ' || coalesce(v_ind,'—') || E'\n'
|| E'Vazamento:   R$ ' || coalesce(v_vaz,'—') || E'\n'
|| E'Buracos:     ' || coalesce(v_bur,'—') || E'\n'
|| E'Faturamento: ' || v_fat || E'   |   Vendedores: ' || v_vend || E'   |   Leads/mes: ' || v_leads || E'\n'
|| E'Bateu na conversa?  [ OK bate ]  [ DIVERGIU: ______________ ]\n'
|| E'\n[ 2 · A DOR, NAS PALAVRAS DELE ]  * obrigatorio *\n'
|| E'Frase dele: "                                                          "\n'
|| E'Ha quanto tempo: \n'
|| E'Ja tentou resolver antes? O que aconteceu: \n'
|| E'O que isso esta custando (R$, tempo, time): \n'
|| E'Como afeta ELE - rotina, cabeca, familia: \n'
|| E'\n[ 3 · ORCAMENTO E DECISAO ]  * obrigatorio *\n'
|| E'Reacao a faixa (R$6k/mes · R$18k nos 90 dias): \n'
|| E'Ja investiu em curso/mentoria/consultoria? Quanto: \n'
|| E'Quem mais decide junto: \n'
|| E'O que precisa acontecer pra avancar: \n'
|| E'E prioridade agora ou "ano que vem"? \n'
|| E'\n[ 4 · MINHA LEITURA ]\n'
|| E'Produto:  [ Sprint / Central de Receita / AUGRA / EQV ]  porque: \n'
|| E'Objecao que ja apareceu: \n'
|| E'Temperatura: [ quente / morno / frio ]    No-show: [ baixo / medio / alto ] porque: \n'
|| E'O que NAO falar / assunto sensivel: ';

  insert into deal_notes (deal_id, account_id, title, body, kind, position)
  values (new.id, new.account_id, 'Qualificação SDR', v_body, 'qualificacao_sdr', 10);

  return null;

exception when others then
  raise warning 'inserir_dossie_handoff falhou no deal %: %', new.id, sqlerrm;
  return null;
end;
$fn$;

drop trigger if exists trg_dossie_handoff on public.deals;
create trigger trg_dossie_handoff
after update of stage_id on public.deals
for each row execute function public.inserir_dossie_handoff();
