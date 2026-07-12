// Worker de disparo (server-side). Dreno de destinatários `pending` de um
// broadcast, enviando via Meta com claim atômico (anti-duplo-envio). Usado
// pelo endpoint /api/whatsapp/broadcast/process, chamado pelo pg_cron.
//
// NÃO resolve público (isso continua client-side, no enfileiramento). Aqui só
// mandamos para quem já está em broadcast_recipients com status 'pending'.
// Reusa a mesma mecânica de envio da rota de broadcast (sendTemplateMessage,
// variantes de telefone, template carregado 1×).

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendTemplateMessage } from "@/lib/whatsapp/meta-api";
import { isMessageTemplate } from "@/lib/whatsapp/template-row-guard";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";

type Admin = ReturnType<typeof supabaseAdmin>;

type VariableMapping =
  | { type: "static"; value: string }
  | { type: "field"; value: string }
  | { type: "custom_field"; value: string };

// Mesma lógica do hook client (resolveVariables), server-side.
function resolveVars(
  variables: Record<string, VariableMapping>,
  contact: { name?: string | null; phone?: string | null; email?: string | null; company?: string | null },
  customValues: Map<string, string> | undefined,
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });
  return keys.map((key) => {
    const v = variables[key];
    if (v.type === "static") return v.value;
    if (v.type === "field") {
      const map: Record<string, string | null | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return map[v.value] ?? "";
    }
    return customValues?.get(v.value) ?? "";
  });
}

async function fetchCustomValues(
  admin: Admin,
  contactIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const index = new Map<string, Map<string, string>>();
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await admin
      .from("contact_custom_values")
      .select("contact_id, custom_field_id, value")
      .in("contact_id", slice);
    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? "");
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

interface BroadcastRow {
  id: string;
  account_id: string;
  template_name: string;
  template_language: string | null;
  template_variables: Record<string, VariableMapping> | null;
  status: string;
}

/**
 * Envia até `maxSend` destinatários pending de um broadcast. Retorna quantos
 * foram processados (enviados+falhos). Se 0, não havia pending disponível.
 */
async function drainBroadcast(
  admin: Admin,
  b: BroadcastRow,
  maxSend: number,
): Promise<number> {
  // Config + token da conta.
  const { data: config } = await admin
    .from("whatsapp_config")
    .select("phone_number_id, access_token")
    .eq("account_id", b.account_id)
    .maybeSingle();
  if (!config?.access_token || !config.phone_number_id) return 0;

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch {
    return 0;
  }

  // Template row (1×). Se malformado, aborta o broadcast.
  const { data: rawTemplate } = await admin
    .from("message_templates")
    .select("*")
    .eq("account_id", b.account_id)
    .eq("name", b.template_name)
    .eq("language", b.template_language || "en_US")
    .maybeSingle();
  const templateRow =
    rawTemplate && isMessageTemplate(rawTemplate) ? rawTemplate : undefined;

  const variables = b.template_variables ?? {};

  // Claim atômico.
  const { data: claimed } = await admin.rpc("claim_broadcast_recipients", {
    p_broadcast: b.id,
    p_limit: maxSend,
  });
  const claims = (claimed ?? []) as { recipient_id: string; contact_id: string }[];
  if (claims.length === 0) return 0;

  // Contatos + custom values.
  const contactIds = claims.map((c) => c.contact_id).filter(Boolean);
  const { data: contacts } = await admin
    .from("contacts")
    .select("id, name, phone, email, company")
    .in("id", contactIds);
  const contactById = new Map(
    (contacts ?? []).map((c) => [c.id as string, c]),
  );
  const customIndex = await fetchCustomValues(admin, contactIds);

  let processed = 0;
  for (const claim of claims) {
    const contact = contactById.get(claim.contact_id);
    const phone = contact?.phone as string | undefined;
    if (!phone) {
      await admin
        .from("broadcast_recipients")
        .update({ status: "failed", error_message: "Sem telefone no contato", claimed_at: null })
        .eq("id", claim.recipient_id);
      processed++;
      continue;
    }

    const sanitized = sanitizePhoneForMeta(phone);
    if (!isValidE164(sanitized)) {
      await admin
        .from("broadcast_recipients")
        .update({ status: "failed", error_message: "Telefone inválido", claimed_at: null })
        .eq("id", claim.recipient_id);
      processed++;
      continue;
    }

    const params = resolveVars(variables, contact!, customIndex.get(claim.contact_id));

    let sentId: string | null = null;
    let lastError: string | null = null;
    for (const variant of phoneVariants(sanitized)) {
      try {
        const res = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: variant,
          templateName: b.template_name,
          language: b.template_language || "en_US",
          template: templateRow,
          params,
        });
        sentId = res.messageId;
        lastError = null;
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        lastError = msg;
        if (!isRecipientNotAllowedError(msg)) break;
      }
    }

    if (sentId) {
      await admin
        .from("broadcast_recipients")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentId,
          error_message: null,
          claimed_at: null,
        })
        .eq("id", claim.recipient_id);
    } else {
      await admin
        .from("broadcast_recipients")
        .update({ status: "failed", error_message: lastError ?? "Erro desconhecido", claimed_at: null })
        .eq("id", claim.recipient_id);
    }
    processed++;
  }

  // Toca o broadcast (updated_at) — sinaliza atividade e adia o takeover.
  await admin.from("broadcasts").update({ updated_at: new Date().toISOString() }).eq("id", b.id);

  return processed;
}

/**
 * Finaliza broadcasts sem pending restante: status 'sent' (ou 'failed' se
 * todos falharam). Chamado após o dreno.
 */
async function finalizeIfDone(admin: Admin, broadcastId: string): Promise<void> {
  const { count: pendingCount } = await admin
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending");
  if ((pendingCount ?? 0) > 0) return;

  const { count: total } = await admin
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId);
  const { count: failed } = await admin
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("status", "failed");
  const final = (total ?? 0) > 0 && failed === total ? "failed" : "sent";
  await admin.from("broadcasts").update({ status: final }).eq("id", broadcastId);
}

/**
 * Seleciona broadcasts que precisam de dreno server-side e os processa dentro
 * de um orçamento total de envios (para caber no tempo do serverless):
 *   - 'scheduled' cujo scheduled_at venceu → vira 'sending' e drena;
 *   - 'sending' ocioso (sem progresso há > 2 min) com pending → assume (a aba
 *     do usuário fechou no meio).
 */
export async function processDueBroadcasts(totalBudget = 120): Promise<{
  processed: number;
  broadcasts: number;
}> {
  const admin = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  // Agendados vencidos → sending.
  const { data: dueScheduled } = await admin
    .from("broadcasts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .limit(20);
  for (const b of dueScheduled ?? []) {
    await admin.from("broadcasts").update({ status: "sending" }).eq("id", b.id);
  }

  // Candidatos a dreno (status 'sending'):
  //   - scheduled_at NÃO nulo → foi agendado/rascunho promovido pelo worker
  //     (sem cliente ativo) → drena já;
  //   - scheduled_at nulo (é um "Enviar agora" client-side) → só drena se
  //     ficou OCIOSO > 2min (a aba fechou no meio) — takeover, sem colidir
  //     com o cliente que está enviando.
  const { data: sending } = await admin
    .from("broadcasts")
    .select(
      "id, account_id, template_name, template_language, template_variables, status, updated_at",
    )
    .eq("status", "sending")
    .or(`scheduled_at.not.is.null,updated_at.lte.${staleIso}`)
    .order("updated_at", { ascending: true })
    .limit(20);

  let processed = 0;
  let touched = 0;
  let budget = totalBudget;
  for (const b of (sending ?? []) as (BroadcastRow & { updated_at: string })[]) {
    if (budget <= 0) break;
    const n = await drainBroadcast(admin, b, Math.min(budget, 40));
    processed += n;
    budget -= n;
    if (n > 0) touched++;
    await finalizeIfDone(admin, b.id);
  }

  return { processed, broadcasts: touched };
}
