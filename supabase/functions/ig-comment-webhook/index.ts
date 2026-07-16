// ig-comment-webhook: comment-to-DM + INBOX de DMs no CRM.
//
// Webhook único do objeto `instagram` (por-app). Roteia por campo:
//   - changes[].field === "comments"  -> comment-to-DM (resposta pública + DM)
//   - messaging[]                     -> DM recebida:
//        (a) loga em ig_dm_events (prova/telemetria, mantido);
//        (b) grava em contacts/conversations/messages do CRM (Fase 1 do inbox).
//
// Envio de DM pelo Messenger Platform: POST /{PAGE_ID}/messages (NUNCA /{IG_ID}).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IG_TOKEN = Deno.env.get("IG_TOKEN") ?? "";
const GRAPH = "https://graph.facebook.com/v22.0";
const PAGE_ID = "152902442083026";
const IG_ID = "17841439327821349";
const REST = SUPABASE_URL + "/rest/v1";
const H = { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY };
const enc = new TextEncoder();

async function cfg(key: string): Promise<string | null> {
  const r = await fetch(`${REST}/ig_app_config?key=eq.${key}&select=value`, { headers: H });
  const j = await r.json();
  return j[0]?.value ?? null;
}
async function graphGet(path: string, params: Record<string, string>) {
  const r = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`);
  return await r.json();
}
async function pageToken(): Promise<string> {
  const pg = await graphGet(PAGE_ID, { fields: "access_token", access_token: IG_TOKEN });
  return pg.access_token ?? IG_TOKEN;
}
function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}
async function validSig(secret: string, raw: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === "sha256=" + hex;
}
async function postMsg(PT: string, payload: unknown) {
  const r = await fetch(`${GRAPH}/${PAGE_ID}/messages?access_token=${encodeURIComponent(PT)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  return await r.json();
}
async function replyPublic(commentId: string, msg: string, PT: string) {
  const r = await fetch(`${GRAPH}/${commentId}/replies`, { method: "POST", body: new URLSearchParams({ message: msg, access_token: PT }) });
  const j = await r.json();
  if (j.error) throw new Error("reply: " + j.error.message);
  return j;
}
async function sendDM(commentId: string, text: string, PT: string) {
  const url = (text.match(/https?:\/\/\S+/) || [])[0];
  if (url) {
    const title = (text.split("👉")[0].replace(url, "").replace(/me chama no WhatsApp aqui/i, "").trim() || "Toca pra receber").slice(0, 78);
    const tpl = { recipient: { comment_id: commentId }, message: { attachment: { type: "template", payload: {
      template_type: "generic", elements: [{ title, subtitle: "Toca no botão pra receber no WhatsApp 👇",
        buttons: [{ type: "web_url", url, title: "Receber no WhatsApp" }] }] } } } };
    const j = await postMsg(PT, tpl);
    if (!j.error) return j;
    console.error("dm template falhou, fallback texto:", j.error?.message);
  }
  const j2 = await postMsg(PT, { recipient: { comment_id: commentId }, message: { text } });
  if (j2.error) throw new Error("dm: " + j2.error.message);
  return j2;
}

// deno-lint-ignore no-explicit-any
async function handleComment(v: any, PT: string, rules: any[]) {
  const commentId = v.id;
  const fromId = v.from?.id ?? null;
  if (!commentId || fromId === IG_ID) return;
  const ins = await fetch(`${REST}/ig_comment_events`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ comment_id: commentId, media_id: v.media?.id ?? null, from_id: fromId, from_username: v.from?.username ?? null, text: v.text ?? null }),
  });
  if (ins.status === 409) return;
  const nt = norm(v.text);
  const rule = rules.find((r) => nt.includes(norm(r.keyword)));
  // deno-lint-ignore no-explicit-any
  const patch: any = {};
  if (!rule) { patch.matched_keyword = null; }
  else {
    patch.matched_keyword = rule.keyword;
    try { await replyPublic(commentId, rule.public_reply, PT); patch.public_replied = true; } catch (e) { patch.error = String(e); }
    try { await sendDM(commentId, rule.dm_text, PT); patch.dm_sent = true; } catch (e) { patch.error = (patch.error ? patch.error + " | " : "") + String(e); }
  }
  await fetch(`${REST}/ig_comment_events?comment_id=eq.${encodeURIComponent(commentId)}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(patch) });
}

// LOG de DM recebida (prova/telemetria). entry[].messaging[] = formato do Instagram.
// deno-lint-ignore no-explicit-any
async function logDM(m: any) {
  const msg = m.message; if (!msg) return;
  await fetch(`${REST}/ig_dm_events`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal,resolution=ignore-duplicates" },
    body: JSON.stringify({ mid: msg.mid, sender_id: m.sender?.id ?? null, text: msg.text ?? null, is_echo: !!msg.is_echo, raw: m }),
  });
}

// ============================================================
// INBOX (Fase 1) — grava a DM recebida nas tabelas do CRM.
// Como a Edge Function e o CRM usam o MESMO Supabase, escrevemos direto
// em contacts/conversations/messages com a service key (Forma A do plano).
// ============================================================

// Rótulo curto para anexos (Fase 1 é texto; mídia é Fase 2).
// deno-lint-ignore no-explicit-any
function igAttachmentLabel(msg: any): string {
  const a = msg.attachments?.[0];
  if (!a) return "[mensagem]";
  const t = a.type;
  if (t === "image") return "[imagem]";
  if (t === "video") return "[vídeo]";
  if (t === "audio") return "[áudio]";
  if (t === "file") return "[arquivo]";
  if (t === "share") return "[compartilhamento]";
  if (t === "story_mention") return "[menção em story]";
  return `[${t ?? "anexo"}]`;
}
// deno-lint-ignore no-explicit-any
function dmText(msg: any): string {
  return (msg.text && String(msg.text)) || igAttachmentLabel(msg);
}

// Resolve o canal Instagram pela conta que RECEBEU a DM (recipient.id).
// Preferimos casar por ig_user_id/ig_page_id; se não casar (ex.: id
// page-scoped), caímos no único canal IG configurado (Fase 1 = 1 conta).
async function resolveIgChannel(recipientId: string): Promise<
  { id: string; account_id: string; user_id: string } | null
> {
  const byId = await fetch(
    `${REST}/whatsapp_config?channel_type=eq.instagram&or=(ig_user_id.eq.${encodeURIComponent(recipientId)},ig_page_id.eq.${encodeURIComponent(recipientId)})&select=id,account_id,user_id&limit=1`,
    { headers: H },
  );
  const rows = await byId.json();
  if (Array.isArray(rows) && rows[0]) return rows[0];

  const all = await fetch(
    `${REST}/whatsapp_config?channel_type=eq.instagram&select=id,account_id,user_id&limit=2`,
    { headers: H },
  );
  const list = await all.json();
  if (Array.isArray(list) && list.length === 1) return list[0];
  return null;
}

// Upsert do contato por (account_id, instagram_id). Não sobrescreve um
// nome já editado no CRM; atualiza @username e foto quando mudam.
async function upsertIgContact(
  accountId: string,
  userId: string,
  igsid: string,
  username: string | null,
  name: string | null,
  pic: string | null,
): Promise<{ id: string; created: boolean } | null> {
  const look = await fetch(
    `${REST}/contacts?account_id=eq.${accountId}&instagram_id=eq.${encodeURIComponent(igsid)}&select=id,name,instagram_username,avatar_url&limit=1`,
    { headers: H },
  );
  const rows = await look.json();
  if (Array.isArray(rows) && rows[0]) {
    const c = rows[0];
    // deno-lint-ignore no-explicit-any
    const patch: any = {};
    if (username && username !== c.instagram_username) patch.instagram_username = username;
    if (name && !c.name) patch.name = name;
    if (pic && pic !== c.avatar_url) patch.avatar_url = pic;
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      await fetch(`${REST}/contacts?id=eq.${c.id}`, {
        method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
    }
    return { id: c.id, created: false };
  }

  const ins = await fetch(`${REST}/contacts`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      account_id: accountId,
      user_id: userId,
      instagram_id: igsid,
      instagram_username: username,
      name: name ?? null,
      avatar_url: pic,
    }),
  });
  if (ins.status === 409) {
    // Corrida: outra entrega criou o contato entre o look e o insert.
    const again = await fetch(
      `${REST}/contacts?account_id=eq.${accountId}&instagram_id=eq.${encodeURIComponent(igsid)}&select=id&limit=1`,
      { headers: H },
    );
    const rows2 = await again.json();
    return Array.isArray(rows2) && rows2[0] ? { id: rows2[0].id, created: false } : null;
  }
  const created = await ins.json();
  return Array.isArray(created) && created[0] ? { id: created[0].id, created: true } : null;
}

async function findOrCreateIgConversation(
  accountId: string,
  userId: string,
  contactId: string,
  channelId: string,
): Promise<{ id: string; unread_count: number } | null> {
  const look = await fetch(
    `${REST}/conversations?account_id=eq.${accountId}&contact_id=eq.${contactId}&channel_id=eq.${channelId}&select=id,unread_count&limit=1`,
    { headers: H },
  );
  const rows = await look.json();
  if (Array.isArray(rows) && rows[0]) return rows[0];

  const ins = await fetch(`${REST}/conversations`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ account_id: accountId, user_id: userId, contact_id: contactId, channel_id: channelId }),
  });
  const created = await ins.json();
  return Array.isArray(created) && created[0] ? created[0] : null;
}

// Insere a mensagem recebida — idempotente por (conversation_id, message_id)
// para tolerar reentregas do webhook da Meta.
// deno-lint-ignore no-explicit-any
async function insertIgMessage(convId: string, msg: any): Promise<boolean> {
  const mid = msg.mid ?? null;
  if (mid) {
    const chk = await fetch(
      `${REST}/messages?conversation_id=eq.${convId}&message_id=eq.${encodeURIComponent(mid)}&select=id&limit=1`,
      { headers: H },
    );
    const ex = await chk.json();
    if (Array.isArray(ex) && ex[0]) return false; // já gravada
  }
  await fetch(`${REST}/messages`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      conversation_id: convId,
      sender_type: "customer",
      content_type: "text",
      content_text: dmText(msg),
      message_id: mid,
      status: "delivered",
    }),
  });
  return true;
}

// deno-lint-ignore no-explicit-any
async function bumpConversation(convId: string, curUnread: number, msg: any): Promise<void> {
  const now = new Date().toISOString();
  await fetch(`${REST}/conversations?id=eq.${convId}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({
      last_message_text: dmText(msg),
      last_message_at: now,
      unread_count: (curUnread ?? 0) + 1,
      updated_at: now,
    }),
  });
}

// Dispara as engines do CRM (flows/automations/agente de IA) para a DM recém
// gravada. As engines vivem no Next (Vercel), então chamamos o endpoint
// /api/instagram/process autenticado pelo segredo em ig_app_config. Best-effort.
async function callEngines(payload: Record<string, unknown>): Promise<void> {
  const crmUrl = await cfg("crm_url");
  const secret = await cfg("ingest_secret");
  if (!crmUrl || !secret) {
    console.warn("callEngines: crm_url/ingest_secret ausente em ig_app_config");
    return;
  }
  const r = await fetch(`${crmUrl.replace(/\/+$/, "")}/api/instagram/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ig-secret": secret },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    console.error("callEngines HTTP", r.status, await r.text().catch(() => ""));
  }
}

// Orquestra a gravação da DM recebida no CRM. Best-effort: qualquer falha
// é logada e NÃO derruba o webhook (a DM já ficou em ig_dm_events).
// deno-lint-ignore no-explicit-any
async function writeDmToCrm(m: any, PT: string): Promise<void> {
  const msg = m.message;
  if (!msg || msg.is_echo) return;              // só DMs recebidas (ignora echo)
  const igsid = m.sender?.id;
  const recipientId = m.recipient?.id;
  if (!igsid || !recipientId) return;

  const ch = await resolveIgChannel(String(recipientId));
  if (!ch) { console.warn("writeDmToCrm: sem canal IG para recipient", recipientId); return; }

  // Enriquecimento de perfil (best-effort).
  let username: string | null = null, name: string | null = null, pic: string | null = null;
  try {
    const prof = await graphGet(String(igsid), { fields: "username,name,profile_pic", access_token: PT });
    if (!prof.error) {
      username = prof.username ?? null;
      name = prof.name ?? null;
      pic = prof.profile_pic ?? null;
    }
  } catch (_e) { /* segue sem enriquecer */ }

  const contact = await upsertIgContact(ch.account_id, ch.user_id, String(igsid), username, name, pic);
  if (!contact) { console.error("writeDmToCrm: falha no upsert do contato", igsid); return; }

  const conv = await findOrCreateIgConversation(ch.account_id, ch.user_id, contact.id, ch.id);
  if (!conv) { console.error("writeDmToCrm: falha na conversa", contact.id); return; }

  const inserted = await insertIgMessage(conv.id, msg);
  if (inserted) {
    await bumpConversation(conv.id, conv.unread_count, msg);
    // Forma A: as engines vivem no Next — dispara flows/automations/agente.
    await callEngines({
      accountId: ch.account_id,
      userId: ch.user_id,
      conversationId: conv.id,
      contactId: contact.id,
      channelId: ch.id,
      text: dmText(msg),
      metaMessageId: msg.mid ?? "",
      wasContactCreated: contact.created,
    }).catch((e) => console.error("callEngines", String(e)));
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = await cfg("ig_verify_token");
    if (mode === "subscribe" && token && token === expected) return new Response(challenge ?? "", { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  try {
    const raw = await req.text();
    const secret = await cfg("ig_app_secret");
    const ok = await validSig(secret ?? "", raw, req.headers.get("x-hub-signature-256"));
    if (!ok) return new Response("bad signature", { status: 401 });
    const body = JSON.parse(raw);
    if (body.object !== "instagram") return new Response("ignored", { status: 200 });
    const rules = await (await fetch(`${REST}/ig_keyword_rules?active=eq.true&select=keyword,public_reply,dm_text`, { headers: H })).json();
    const PT = await pageToken();
    for (const entry of body.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        if (ch.field === "comments" && ch.value) {
          try { await handleComment(ch.value, PT, rules); } catch (e) { console.error("handleComment", String(e)); }
        }
      }
      for (const m of entry.messaging ?? []) {
        // (a) telemetria — mantém a prova em ig_dm_events.
        try { await logDM(m); } catch (e) { console.error("logDM", String(e)); }
        // (b) inbox — grava a DM recebida no CRM (Fase 1).
        try { await writeDmToCrm(m, PT); } catch (e) { console.error("writeDmToCrm", String(e)); }
      }
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (e) {
    console.error("webhook error", String(e));
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
});
