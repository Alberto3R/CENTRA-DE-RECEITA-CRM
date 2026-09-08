import { createClient } from "npm:@supabase/supabase-js@2";

const ACCOUNT_ID = "fd9b374f-e140-4bd4-8200-f8663fb09705"; // Sales 3R
const USER_ID = "b5180f1b-fc91-48ae-9fcd-48bcbdcdb75b";    // adm@sales3r.com.br (owner)
const PIPELINE_NAME = "Tráfego Pago";
const TOKEN = "diag3r_2026_sc9k4";
const TAG_NAME = "Diagnóstico Comercial";
const TAG_COLOR = "#A6E43C";

// --- Abertura automática no WhatsApp ---
// Enfileira a abertura NA HORA que o lead entra, agendada para +2min: essa é a
// REDE DE SEGURANÇA. Quando o PDF fica pronto (~15s), a `diag-pdf` troca este
// mesmo broadcast pelo template COM o link e antecipa o envio.
// ⚠️ Tudo em categoria **UTILITY**: template Marketing bate no limite de
// ecossistema da Meta (erro 131049) e não é entregue para parte dos leads.
//
// 08/set/2026: a guarda contra abertura repetida deixou de ser "existe algum
// disparo com esse nome?" e passou a ser `reservar_toque` (migração 096). A
// guarda por nome dependia de a lista de disparos estar sã — e foi exatamente
// ela que apodreceu no incidente da cadência, que reabriu o mesmo lead 11× por
// dia. Agora quem decide é o UNIQUE do banco, e a `diag-cadencia` lê a mesma
// tabela, então os dois caminhos enxergam o mesmo estado.
const CHANNEL_ID = "1c5d1f80-a6b3-43a8-8955-2a77770be89a";
const TPL_FALLBACK = "diag_toque3_consultoria"; // Utility · {{1}} nome (sem PDF ainda)
const REDE_MS = 120000;                          // 2 min
const CADENCIA = "diagnostico";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}
const S = (v: unknown) => (v === undefined || v === null ? "" : String(v)).trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    // deno-lint-ignore no-explicit-any
    const body = await req.json().catch(() => ({} as any));
    if (body.token !== TOKEN) return json({ error: "unauthorized" }, 401);
    if (body.company_website) return json({ ok: true }); // honeypot

    const name = S(body.nome) || "Lead sem nome";
    const company = S(body.empresa);
    const email = S(body.email) || null;
    let phoneNorm = S(body.whatsapp).replace(/\D/g, "");
    if (phoneNorm && phoneNorm.length <= 11 && !phoneNorm.startsWith("55")) phoneNorm = "55" + phoneNorm;

    const nivel = S(body.nivel);
    const indice = body.indice;
    const vaz = Number(body.vazamento_estimado || 0);
    const vazBRL = vaz ? vaz.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "—";
    const buracos: string[] = Array.isArray(body.buracos) ? body.buracos.map((b: unknown) => S(b)).filter(Boolean) : [];

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: pipe } = await sb.from("pipelines").select("id").eq("account_id", ACCOUNT_ID).eq("name", PIPELINE_NAME).limit(1).maybeSingle();
    if (!pipe) return json({ error: "pipeline_not_found", PIPELINE_NAME }, 500);
    const { data: stage } = await sb.from("pipeline_stages").select("id").eq("pipeline_id", pipe.id).order("position", { ascending: true }).limit(1).maybeSingle();

    let contactId: string;
    if (phoneNorm) {
      const { data: existing } = await sb.from("contacts").select("id").eq("account_id", ACCOUNT_ID).eq("phone_normalized", phoneNorm).limit(1).maybeSingle();
      if (existing) {
        contactId = existing.id;
        const upd: Record<string, unknown> = { name };
        if (company) upd.company = company;
        if (email) upd.email = email;
        await sb.from("contacts").update(upd).eq("id", contactId);
      } else {
        const { data: c, error } = await sb.from("contacts").insert({ account_id: ACCOUNT_ID, user_id: USER_ID, name, phone: phoneNorm, email, company: company || null }).select("id").single();
        if (error) return json({ error: "contact_insert:" + error.message }, 500);
        contactId = c!.id;
      }
    } else {
      const { data: c, error } = await sb.from("contacts").insert({ account_id: ACCOUNT_ID, user_id: USER_ID, name, email, company: company || null }).select("id").single();
      if (error) return json({ error: "contact_insert:" + error.message }, 500);
      contactId = c!.id;
    }

    let { data: tag } = await sb.from("tags").select("id").eq("account_id", ACCOUNT_ID).eq("name", TAG_NAME).limit(1).maybeSingle();
    if (!tag) {
      const { data: nt } = await sb.from("tags").insert({ account_id: ACCOUNT_ID, user_id: USER_ID, name: TAG_NAME, color: TAG_COLOR }).select("id").single();
      tag = nt;
    }
    if (tag) {
      const { data: linked } = await sb.from("contact_tags").select("id").eq("contact_id", contactId).eq("tag_id", tag.id).limit(1).maybeSingle();
      if (!linked) await sb.from("contact_tags").insert({ contact_id: contactId, tag_id: tag.id });
    }

    let title = name;
    if (company) title += " — " + company;
    if (nivel) title += " · " + nivel;

    const notes: string[] = ["Origem: Diagnóstico do Comercial (anúncio Vendedor Sem Controle)"];
    if (indice !== undefined && indice !== null) notes.push(`Índice: ${indice}/100${nivel ? " — " + nivel : ""}`);
    notes.push("Vazamento estimado: " + vazBRL + " /mês");
    if (buracos.length) notes.push("Maiores buracos: " + buracos.join(" · "));
    if (email) notes.push("E-mail: " + email);
    if (phoneNorm) notes.push("WhatsApp: " + phoneNorm);
    const utm = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_placement"]
      .map((k) => body[k] ? `${k}=${S(body[k])}` : "").filter(Boolean);
    if (utm.length) notes.push("UTMs: " + utm.join(" · "));
    if (body.fbclid) notes.push("fbclid: " + S(body.fbclid));
    if (body.event_id) notes.push("event_id: " + S(body.event_id));
    if (body.campanha || body.origem) notes.push("Campanha: " + S(body.campanha) + (body.origem ? " / " + S(body.origem) : ""));
    if (body.respostas && typeof body.respostas === "object") {
      try { notes.push("Respostas: " + JSON.stringify(body.respostas)); } catch (_e) { /* ignore */ }
    }

    const { data: deal, error: derr } = await sb.from("deals").insert({
      account_id: ACCOUNT_ID, user_id: USER_ID, pipeline_id: pipe.id, stage_id: stage?.id ?? null,
      contact_id: contactId, title, value: 0, status: "open", notes: notes.join("\n"),
    }).select("id").single();
    if (derr) return json({ error: "deal_insert:" + derr.message }, 500);

    // ---- ABERTURA AUTOMÁTICA (rede em +2min; a diag-pdf antecipa com o PDF) ----
    let disparo = "nao_enfileirado";
    try {
      if (phoneNorm) {
        const primeiro = name.split(/\s+/)[0];
        const { data: tpl } = await sb.from("message_templates").select("status")
          .eq("channel_id", CHANNEL_ID).eq("name", TPL_FALLBACK).eq("language", "pt_BR").maybeSingle();
        if (tpl?.status !== "APPROVED") {
          disparo = "sem_template_aprovado";
        } else {
          const { data: reservou, error: eRes } = await sb.rpc("reservar_toque", {
            p_account: ACCOUNT_ID, p_contact: contactId, p_cadencia: CADENCIA,
            p_toque: 1, p_template: TPL_FALLBACK,
          });
          if (eRes) {
            disparo = "erro_reserva:" + eRes.message;
          } else if (reservou !== true) {
            disparo = "ja_contatado";
          } else {
            const { data: bc, error: bcErr } = await sb.from("broadcasts").insert({
              account_id: ACCOUNT_ID, user_id: USER_ID, channel_id: CHANNEL_ID,
              name: `Diag abertura · ${primeiro} · ${contactId}`,
              kind: "system",
              template_name: TPL_FALLBACK, template_language: "pt_BR",
              template_variables: { "1": { type: "static", value: primeiro } },
              status: "draft", total_recipients: 1,
              sent_count: 0, delivered_count: 0, read_count: 0, replied_count: 0, failed_count: 0,
            }).select("id").single();
            if (bcErr || !bc) {
              // Devolve o toque: reservado e não enfileirado trava o lead.
              await sb.from("outbound_touches")
                .update({ status: "falhou", updated_at: new Date(Date.now() - 7 * 3600000).toISOString() })
                .eq("account_id", ACCOUNT_ID).eq("contact_id", contactId)
                .eq("cadencia", CADENCIA).eq("toque", 1);
              disparo = "erro:" + (bcErr?.message ?? "?");
            } else {
              await sb.from("broadcast_recipients").insert({ broadcast_id: bc.id, contact_id: contactId, status: "pending" });
              await sb.from("broadcasts").update({
                status: "scheduled",
                scheduled_at: new Date(Date.now() + REDE_MS).toISOString(),
              }).eq("id", bc.id);
              await sb.rpc("vincular_broadcast_ao_toque", {
                p_account: ACCOUNT_ID, p_contact: contactId, p_cadencia: CADENCIA, p_toque: 1, p_broadcast: bc.id,
              });
              disparo = "enfileirado_rede_2min";
            }
          }
        }
      }
    } catch (e) {
      disparo = "erro:" + String(e);
    }

    return json({ ok: true, deal_id: deal!.id, contact_id: contactId, pipeline: PIPELINE_NAME, disparo });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
