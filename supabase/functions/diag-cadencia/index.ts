// diag-cadencia — cérebro das tentativas de contato do funil Diagnóstico.
//
// 5 toques no WhatsApp. Template **Utility** sempre que a mensagem é crítica,
// porque Marketing bate no limite de ecossistema da Meta (131049) e não é
// entregue para parte dos leads.
//
//   toque 1  abertura                          [intake+diag-pdf, ou aqui se falhou/nunca saiu]
//   toque 2  +1 dia  diag_abertura_pdf         (nome + link do PDF)
//   toque 3  +2 dias diag_toque3_consultoria   (nome)
//   toque 4  +3 dias diag_toque4_buraco        (nome + buraco principal)
//   toque 5  +4 dias diag_toque5_encerrar      (nome)
//   +3 dias sem resposta -> etapa "Sem resposta (reativar)"
//
// PARA quando o lead responde (Léo assume), se o negócio sai de Prospecção, ou
// se as notas têm [SEM CADENCIA] (lead tocado na mão fora do CRM).
//
// ============================================================
// REESCRITA DE 08/set/2026 — o incidente que motivou
// ============================================================
// A versão anterior não guardava em lugar nenhum quantos toques cada lead já
// tinha levado: ela DEDUZIA isso lendo o nome de TODOS os disparos já criados
// e cruzando com os destinatários num `.in(<milhares de ids>)`. Quando essa
// lista passou do que o PostgREST aceita numa URL, a consulta passou a falhar;
// o helper de paginação engolia o erro e devolvia lista vazia; todo lead virava
// "nunca recebeu nada" e levava a abertura de novo — de hora em hora, 11× por
// dia, de 02 a 08/set. 3.694 envios para 131 pessoas, algumas 76 vezes. E o
// loop se alimentava: cada envio criava mais um disparo, que engordava a lista
// que quebrava a consulta.
//
// Três mudanças estruturais, nesta ordem de importância:
//
//  1. O ESTADO SAIU DA DEDUÇÃO. `outbound_touches` tem UNIQUE (conta, contato,
//     cadência, toque) e `reservar_toque()` devolve true uma única vez por
//     toque. Mesmo que esta função volte a ter bug, o banco não deixa a mesma
//     pessoa receber o mesmo toque duas vezes.
//  2. ERRO DE LEITURA ABORTA A RODADA. Não saber o histórico não pode mais ser
//     lido como "ninguém recebeu nada". Na dúvida, não manda.
//  3. NENHUMA CONSULTA CRESCE COM O HISTÓRICO. Some o `.in()` de milhares de
//     ids; tudo é filtrado por conta, com paginação.
//
// Roda de hora em hora, 09h-19h BRT. POST {} | {"dry_run":true} + x-cron-secret
import { createClient } from "npm:@supabase/supabase-js@2";

const CRON_SECRET = "5E7E61B5-24B0-4913-B27D-452C99844AE3";
const ACCOUNT_ID = "fd9b374f-e140-4bd4-8200-f8663fb09705";
const USER_ID = "b5180f1b-fc91-48ae-9fcd-48bcbdcdb75b";
const CHANNEL_ID = "1c5d1f80-a6b3-43a8-8955-2a77770be89a";
const PIPELINE_ID = "824de2d8-498d-4125-bd18-c22356d249ea";
const ST_PROSPECCAO = "ede60664-0522-4f7d-aa49-d5c1548ecc43";
const ST_SEM_RESPOSTA = "fdf87719-f534-488b-9c47-b62245363ebc";
const MARCADOR_MANUAL = "[SEM CADENCIA]";
const CADENCIA = "diagnostico";

const HORA = 3600000;
const DIA = 86400000;
// espera[toques já entregues] -> quanto esperar antes do próximo
const ESPERA: Record<number, number> = { 0: 2 * HORA, 1: 1 * DIA, 2: 2 * DIA, 3: 3 * DIA, 4: 4 * DIA };
const ESPERA_DESCARTE = 3 * DIA;
const TPL_SIMPLES = "diag_toque3_consultoria";
const TPL_MATERIAL = "diag_toque2_material";
const TPL_TOQUE2 = "diag_abertura_pdf";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "*" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });
const txt = (notes: string, re: RegExp) => { const m = notes.match(re); return m ? m[1].trim() : ""; };

class LeituraFalhou extends Error {}

// PostgREST devolve no máximo 1000 linhas por chamada — paginamos sempre.
// Erro aqui SOBE: uma leitura truncada em silêncio foi a causa do incidente.
// deno-lint-ignore no-explicit-any
async function pageAll(rotulo: string, monta: (de: number, ate: number) => any): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let de = 0; de < 100000; de += 1000) {
    const { data, error } = await monta(de, de + 999);
    if (error) throw new LeituraFalhou(`${rotulo}: ${error.message}`);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return j({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dry = body?.dry_run === true;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const agora = Date.now();
  const acoes: Record<string, unknown>[] = [];

  try {
    const { data: deals, error: eDeals } = await sb.from("deals")
      .select("id,notes,contact_id,created_at,contacts(name,phone)")
      .eq("account_id", ACCOUNT_ID).eq("pipeline_id", PIPELINE_ID)
      .eq("stage_id", ST_PROSPECCAO).eq("status", "open")
      .order("created_at", { ascending: false }).limit(500);
    if (eDeals) throw new LeituraFalhou(`deals: ${eDeals.message}`);

    // 1 toque por PESSOA (o mesmo contato pode ter mais de um negócio)
    // deno-lint-ignore no-explicit-any
    const vistos = new Set<string>();
    // deno-lint-ignore no-explicit-any
    const alvos = (deals ?? []).filter((d: any) => {
      if (!d.contact_id || !d.contacts?.phone) return false;
      if (vistos.has(d.contact_id)) return false;
      vistos.add(d.contact_id);
      return true;
    });
    if (!alvos.length) return j({ ok: true, avaliados: 0, acoes });

    // Quem já respondeu (Léo assume, cadência para). Filtrado por CONTA — não
    // por lista de contatos: era o `.in()` que estourava a URL.
    const convs = await pageAll("conversations", (de, ate) =>
      sb.from("conversations").select("id,contact_id").eq("account_id", ACCOUNT_ID).range(de, ate));
    const convDe: Record<string, string> = {};
    for (const c of convs) convDe[c.id] = c.contact_id;
    const respondeu = new Set<string>();
    const msgs = await pageAll("messages", (de, ate) =>
      sb.from("messages")
        .select("conversation_id,conversations!inner(account_id)")
        .eq("conversations.account_id", ACCOUNT_ID)
        .eq("sender_type", "customer").range(de, ate));
    for (const m of msgs) {
      const cid = convDe[m.conversation_id];
      if (cid) respondeu.add(cid);
    }

    // Estado da régua, direto da tabela. Uma linha por toque, por lead.
    const toquesRows = await pageAll("outbound_touches", (de, ate) =>
      sb.from("outbound_touches").select("contact_id,toque,status,created_at,updated_at")
        .eq("account_id", ACCOUNT_ID).eq("cadencia", CADENCIA).range(de, ate));
    const entregues: Record<string, number> = {};      // maior toque ENTREGUE
    const ultimoOk: Record<string, number> = {};       // quando ele saiu
    const ultimaTentativa: Record<string, number> = {};
    const emVoo = new Set<string>();                   // toque enfileirado, ainda sem desfecho
    for (const t of toquesRows) {
      const cid = t.contact_id as string;
      const quando = Date.parse(t.updated_at ?? t.created_at);
      if (quando && (!ultimaTentativa[cid] || quando > ultimaTentativa[cid])) ultimaTentativa[cid] = quando;
      if (t.status === "entregue") {
        if (!entregues[cid] || t.toque > entregues[cid]) entregues[cid] = t.toque;
        if (quando && (!ultimoOk[cid] || quando > ultimoOk[cid])) ultimoOk[cid] = quando;
      } else if (t.status === "enfileirado" && quando && agora - quando < DIA) {
        // Enfileirado há menos de um dia = toque em voo, espera o desfecho.
        // Passou disso, alguma coisa se perdeu no caminho (disparo que nunca
        // drenou, status que não voltou) e o lead não pode ficar preso para
        // sempre num toque que nunca teve desfecho — a reserva ainda protege
        // contra repetição, porque o toque em si já está gravado.
        emVoo.add(cid);
      }
    }

    const { data: tpls, error: eTpl } = await sb.from("message_templates").select("name,status")
      .eq("channel_id", CHANNEL_ID).eq("language", "pt_BR");
    if (eTpl) throw new LeituraFalhou(`templates: ${eTpl.message}`);
    // deno-lint-ignore no-explicit-any
    const aprovado = (n: string) => (tpls ?? []).some((t: any) => t.name === n && t.status === "APPROVED");

    // deno-lint-ignore no-explicit-any
    for (const d of alvos as any[]) {
      const cid = d.contact_id;
      const notes = d.notes || "";
      const nomeLead = d.contacts.name;
      if (notes.includes(MARCADOR_MANUAL)) { acoes.push({ lead: nomeLead, acao: "manual_fora_da_cadencia" }); continue; }
      if (respondeu.has(cid)) { acoes.push({ lead: nomeLead, acao: "respondeu_parou" }); continue; }
      if (emVoo.has(cid)) continue; // toque na fila, aguarda desfecho

      const toques = entregues[cid] ?? 0;
      const referencia = toques > 0
        ? (ultimoOk[cid] ?? agora)
        : (ultimaTentativa[cid] ?? Date.parse(d.created_at));
      const desde = agora - referencia;
      const nome = String(nomeLead || "").split(/\s+/)[0] || "tudo bem";

      if (toques >= 5) {
        if (desde >= ESPERA_DESCARTE) {
          if (!dry) await sb.from("deals").update({ stage_id: ST_SEM_RESPOSTA, updated_at: new Date().toISOString() }).eq("id", d.id);
          acoes.push({ lead: nomeLead, acao: "descartado_sem_resposta" });
        }
        continue;
      }

      const proximo = toques + 1;
      if (desde < (ESPERA[toques] ?? DIA)) continue;

      const pdf = txt(notes, /PDF do diagnóstico: (\S+)/);
      const buraco = (txt(notes, /Maiores buracos: ([^\n]+)/).split(" · ")[0] || "");
      let tpl = "", vars: Record<string, unknown> = {};
      if (proximo === 1) {
        if (pdf) { tpl = TPL_MATERIAL; vars = { "1": { type: "static", value: nome }, "2": { type: "static", value: pdf } }; }
        else { tpl = TPL_SIMPLES; vars = { "1": { type: "static", value: nome } }; }
      } else if (proximo === 2 && pdf) { tpl = TPL_TOQUE2; vars = { "1": { type: "static", value: nome }, "2": { type: "static", value: pdf } }; }
      else if (proximo === 4 && buraco) { tpl = "diag_toque4_buraco"; vars = { "1": { type: "static", value: nome }, "2": { type: "static", value: buraco } }; }
      else if (proximo === 5) { tpl = "diag_toque5_encerrar"; vars = { "1": { type: "static", value: nome } }; }
      else { tpl = TPL_SIMPLES; vars = { "1": { type: "static", value: nome } }; }
      if (!aprovado(tpl)) {
        if (aprovado(TPL_SIMPLES)) { tpl = TPL_SIMPLES; vars = { "1": { type: "static", value: nome } }; }
        else { acoes.push({ lead: nomeLead, acao: "aguardando_template", toque: proximo }); continue; }
      }

      const rotulo = proximo === 1 ? "abertura" : `toque${proximo}`;
      if (dry) { acoes.push({ lead: nomeLead, acao: "enviaria", toque: proximo, tpl }); continue; }

      // A reserva é a trava: só passa daqui uma vez por toque, por lead.
      const { data: reservou, error: eRes } = await sb.rpc("reservar_toque", {
        p_account: ACCOUNT_ID, p_contact: cid, p_cadencia: CADENCIA,
        p_toque: proximo, p_template: tpl,
      });
      if (eRes) { acoes.push({ lead: nomeLead, acao: "erro_reserva", detalhe: eRes.message }); continue; }
      if (reservou !== true) { acoes.push({ lead: nomeLead, acao: "toque_ja_reservado", toque: proximo }); continue; }

      const { data: bc, error: e1 } = await sb.from("broadcasts").insert({
        account_id: ACCOUNT_ID, user_id: USER_ID, channel_id: CHANNEL_ID,
        name: `Diag ${rotulo} · ${nome} · ${cid}`,
        template_name: tpl, template_language: "pt_BR", template_variables: vars,
        status: "draft", kind: "system", total_recipients: 1,
        sent_count: 0, delivered_count: 0, read_count: 0, replied_count: 0, failed_count: 0,
      }).select("id").single();
      if (e1 || !bc) {
        // Reservou e não conseguiu enfileirar: devolve o toque para retentativa,
        // senão o lead trava para sempre num toque que nunca saiu.
        await sb.from("outbound_touches").update({ status: "falhou", updated_at: new Date(Date.now() - 7 * HORA).toISOString() })
          .eq("account_id", ACCOUNT_ID).eq("contact_id", cid).eq("cadencia", CADENCIA).eq("toque", proximo);
        acoes.push({ lead: nomeLead, acao: "erro", detalhe: e1?.message });
        continue;
      }
      await sb.from("broadcast_recipients").insert({ broadcast_id: bc.id, contact_id: cid, status: "pending" });
      await sb.from("broadcasts").update({ status: "scheduled", scheduled_at: new Date(Date.now() - 60000).toISOString() }).eq("id", bc.id);
      await sb.rpc("vincular_broadcast_ao_toque", {
        p_account: ACCOUNT_ID, p_contact: cid, p_cadencia: CADENCIA, p_toque: proximo, p_broadcast: bc.id,
      });
      acoes.push({ lead: nomeLead, acao: "toque_enfileirado", toque: proximo, tpl });
    }

    return j({ ok: true, dry_run: dry, avaliados: alvos.length, acoes });
  } catch (e) {
    // Leitura falhou = não sabemos o histórico. Sair sem enviar nada é o
    // comportamento correto; foi o oposto disso que gerou o incidente.
    const leitura = e instanceof LeituraFalhou;
    return j({ error: String(e), leitura_falhou: leitura, nada_enviado: leitura, acoes }, 500);
  }
});
