// Gatilho "negócio entra em etapa" (trigger_type = 'deal_stage').
//
// Varre os deal_stage_events recentes e, para cada flow ativo com esse
// gatilho cuja config bate (pipeline/etapas por NOME — portátil entre
// contas), abre a conversa com o lead enviando um TEMPLATE aprovado
// (mensagem ativa fora da janela de 24h exige HSM) e:
//   · mode 'template_only' → encerra aqui; quando o lead responder, o
//     agente IA do canal assume a conversa (maybeRunAgent).
//   · mode 'flow' → cria um flow_run "aguardando a primeira resposta"
//     (vars.__pending_first_advance); a primeira inbound do lead inicia o
//     flow de verdade (aí a janela de 24h está aberta pra sends livres).
//
// Idempotência: flow_deal_trigger_log (unique em stage_event_id+flow_id).
// Template ainda não aprovado NÃO é logado — retenta a cada ciclo até a
// Meta aprovar (limitado pela janela de 24h do sweep).
//
// Chamado pelo pg_cron (1×/min) via /api/automations/deal-triggers/process.

import { decrypt } from "@/lib/whatsapp/encryption";
import { resolveChannelConfig } from "@/lib/whatsapp/channel";
import { sendTemplateMessage } from "@/lib/whatsapp/meta-api";
import { isMessageTemplate } from "@/lib/whatsapp/template-row-guard";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

interface DealStageTriggerConfig {
  pipeline?: string; // nome do pipeline (opcional; etapas costumam bastar)
  stages?: string[]; // nomes das etapas que disparam
  template_name?: string; // HSM de abertura (obrigatório)
  template_param?: "first_name" | "full_name" | "none";
  mode?: "template_only" | "flow";
}

interface FlowRowLite {
  id: string;
  account_id: string;
  user_id: string;
  entry_node_id: string | null;
  trigger_config: DealStageTriggerConfig;
}

export interface DealTriggerSweepResult {
  scanned: number;
  sent: number;
  results: Record<string, unknown>[];
}

export async function processDealStageTriggers(db: Admin): Promise<DealTriggerSweepResult> {
  const out: DealTriggerSweepResult = { scanned: 0, sent: 0, results: [] };

  // 1) flows ativos com o gatilho
  const { data: flows } = await db
    .from("flows")
    .select("id, account_id, user_id, entry_node_id, trigger_config")
    .eq("status", "active")
    .eq("trigger_type", "deal_stage");
  const flowRows = (flows ?? []) as FlowRowLite[];
  if (!flowRows.length) return out;

  const accountIds = [...new Set(flowRows.map((f) => f.account_id))];

  // 2) eventos de etapa das últimas 24h dessas contas
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: events } = await db
    .from("deal_stage_events")
    .select("id, deal_id, stage_id, account_id, entered_at")
    .in("account_id", accountIds)
    .gte("entered_at", since)
    .order("entered_at", { ascending: true })
    .limit(300);
  const evRows = (events ?? []) as {
    id: string;
    deal_id: string;
    stage_id: string | null;
    account_id: string;
  }[];
  out.scanned = evRows.length;
  if (!evRows.length) return out;

  // 3) nomes de etapa/pipeline (matching por nome = portátil entre contas)
  const stageIds = [...new Set(evRows.map((e) => e.stage_id).filter(Boolean))] as string[];
  const { data: stages } = await db
    .from("pipeline_stages")
    .select("id, name, pipeline_id")
    .in("id", stageIds);
  const stageById = new Map(
    ((stages ?? []) as { id: string; name: string; pipeline_id: string }[]).map((s) => [s.id, s]),
  );
  const pipeIds = [...new Set([...stageById.values()].map((s) => s.pipeline_id))];
  const { data: pipes } = pipeIds.length
    ? await db.from("pipelines").select("id, name").in("id", pipeIds)
    : { data: [] };
  const pipeById = new Map(
    ((pipes ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // 4) já processados
  const { data: done } = await db
    .from("flow_deal_trigger_log")
    .select("stage_event_id, flow_id")
    .in("stage_event_id", evRows.map((e) => e.id));
  const doneSet = new Set(
    ((done ?? []) as { stage_event_id: string; flow_id: string }[]).map(
      (d) => `${d.stage_event_id}:${d.flow_id}`,
    ),
  );

  const norm = (s: string) => s.trim().toLowerCase();

  for (const ev of evRows) {
    const stage = ev.stage_id ? stageById.get(ev.stage_id) : null;
    if (!stage) continue;
    const pipeName = pipeById.get(stage.pipeline_id) ?? "";

    for (const flow of flowRows) {
      if (flow.account_id !== ev.account_id) continue;
      if (doneSet.has(`${ev.id}:${flow.id}`)) continue;
      const cfg = flow.trigger_config ?? {};
      const stagesCfg = (cfg.stages ?? []).map(norm);
      if (!stagesCfg.length || !stagesCfg.includes(norm(stage.name))) continue;
      if (cfg.pipeline && norm(cfg.pipeline) !== norm(pipeName)) continue;

      const outcome = await fireForEvent(db, flow, ev);
      // template pendente de aprovação → sem log = retenta no próximo ciclo
      if (outcome === "waiting_template_approval") {
        out.results.push({ event: ev.id, flow: flow.id, outcome });
        continue;
      }
      await db.from("flow_deal_trigger_log").insert({
        stage_event_id: ev.id,
        flow_id: flow.id,
        account_id: ev.account_id,
        deal_id: ev.deal_id,
        outcome,
      });
      doneSet.add(`${ev.id}:${flow.id}`);
      if (outcome === "template_sent" || outcome === "run_started") out.sent++;
      out.results.push({ event: ev.id, flow: flow.id, outcome });
    }
  }
  return out;
}

async function fireForEvent(
  db: Admin,
  flow: FlowRowLite,
  ev: { id: string; deal_id: string; account_id: string },
): Promise<string> {
  const cfg = flow.trigger_config ?? {};
  if (!cfg.template_name) return "skipped_no_template_configured";

  // deal → contato
  const { data: deal } = await db
    .from("deals")
    .select("contact_id")
    .eq("id", ev.deal_id)
    .maybeSingle();
  const contactId = (deal as { contact_id?: string } | null)?.contact_id;
  if (!contactId) return "skipped_no_contact";
  const { data: contact } = await db
    .from("contacts")
    .select("id, name, phone")
    .eq("id", contactId)
    .maybeSingle();
  const phone = (contact as { phone?: string } | null)?.phone;
  if (!phone) return "skipped_no_phone";

  // anti-spam: contato já dentro de um flow ativo → não abre outro
  const { data: activeRun } = await db
    .from("flow_runs")
    .select("id")
    .eq("account_id", flow.account_id)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .maybeSingle();
  if (activeRun) return "skipped_active_run_exists";

  // canal + template APROVADO (gate — igual maybeSendWelcome do /api/leads)
  const wa = await resolveChannelConfig(db, flow.account_id);
  if (!wa?.phone_number_id || !wa?.access_token) return "skipped_no_channel";
  const { data: tpl } = await db
    .from("message_templates")
    .select("*")
    .eq("channel_id", wa.id)
    .eq("name", cfg.template_name)
    .maybeSingle();
  if (!tpl) return "skipped_template_not_found";
  if ((tpl as { status?: string }).status !== "APPROVED") return "waiting_template_approval";

  let token: string;
  try {
    token = decrypt(wa.access_token as string);
  } catch {
    return "error:token_decrypt";
  }

  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) return "skipped_invalid_phone";

  const name = ((contact as { name?: string } | null)?.name ?? "").trim();
  const firstName = name.split(/\s+/)[0] || "tudo bem";
  const params =
    cfg.template_param === "none" ? [] : cfg.template_param === "full_name" ? [name || firstName] : [firstName];

  let sent = false;
  let lastError = "";
  for (const variant of phoneVariants(sanitized)) {
    try {
      await sendTemplateMessage({
        phoneNumberId: wa.phone_number_id as string,
        accessToken: token,
        to: variant,
        templateName: cfg.template_name,
        language: ((tpl as { language?: string }).language as string) || "pt_BR",
        template: isMessageTemplate(tpl) ? tpl : undefined,
        params,
      });
      sent = true;
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "erro";
      if (!isRecipientNotAllowedError(lastError)) break;
    }
  }
  if (!sent) return `error:send:${lastError.slice(0, 120)}`;

  // mode 'flow' → run aguardando a primeira resposta do lead
  if ((cfg.mode ?? "template_only") === "flow" && flow.entry_node_id) {
    const { error: runErr } = await db.from("flow_runs").insert({
      flow_id: flow.id,
      account_id: flow.account_id,
      user_id: flow.user_id,
      contact_id: contactId,
      conversation_id: null,
      status: "active",
      current_node_key: flow.entry_node_id,
      vars: { __pending_first_advance: true, __deal_id: ev.deal_id },
    });
    if (runErr) return "template_sent"; // template foi; run duplicado/erro não derruba
    await db.rpc("increment_flow_execution_count", { p_flow_id: flow.id });
    return "run_started";
  }
  return "template_sent";
}
