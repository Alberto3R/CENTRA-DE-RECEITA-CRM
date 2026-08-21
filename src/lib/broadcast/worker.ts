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
import { resolveChannelConfig } from "@/lib/whatsapp/channel";
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
  // Só as chaves numéricas são variáveis do CORPO ({{1}}, {{2}}, …).
  // Chaves não-numéricas (hoje `buttons`) carregam outra coisa e não podem
  // entrar no array do body — entrariam como um parâmetro fantasma e a Meta
  // recusaria o envio por contagem de variáveis divergente.
  const keys = Object.keys(variables)
    .filter((k) => Number.isFinite(Number(k)))
    .sort((a, b) => Number(a) - Number(b));
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

// Botões de URL dinâmica ({{1}} no fim da URL) exigem um parâmetro próprio
// por botão, numerado pelo índice dele no template — numeração independente
// da do corpo. O mapeamento vive em `template_variables.buttons`, no formato
// { "0": { type: "custom_field", value: "<uuid>" } }.
//
// Sem isso, buildButtonComponent lança
// "URL button #N uses {{1}} — requires a buttonParams[N] value" e o disparo
// inteiro falha. Era o caso de todo template com link individual por pessoa.
function resolveButtonParams(
  variables: Record<string, unknown>,
  contact: { name?: string | null; phone?: string | null; email?: string | null; company?: string | null },
  customValues: Map<string, string> | undefined,
): Record<number, string> | undefined {
  const raw = variables?.buttons as Record<string, VariableMapping> | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<number, string> = {};
  for (const [idx, mapping] of Object.entries(raw)) {
    const i = Number(idx);
    if (!Number.isFinite(i) || !mapping) continue;
    const [value] = resolveVars({ "1": mapping }, contact, customValues);
    if (value) out[i] = value;
  }
  return Object.keys(out).length ? out : undefined;
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
  channel_id: string | null;
  template_name: string;
  template_language: string | null;
  template_variables: Record<string, VariableMapping> | null;
  /**
   * Mídia do cabeçalho escolhida no assistente (migration 089). Um modelo
   * com header de imagem/vídeo/documento precisa mandar a mídia em TODA
   * mensagem; sem isso aqui, o worker só teria o `header_media_url` do
   * template — que é NULL em todo modelo criado no painel da Meta e
   * sincronizado depois (esses só trazem o handle, que não é mídia).
   */
  header_media_url: string | null;
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
  // Canal do disparo (multi-canal) — envia pelo número escolhido; fallback
  // pro primário.
  const config = await resolveChannelConfig(admin, b.account_id, b.channel_id);
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
    .eq("channel_id", config.id)
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
    const buttonParams = resolveButtonParams(
      variables as Record<string, unknown>,
      contact!,
      customIndex.get(claim.contact_id),
    );

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
          messageParams:
            b.header_media_url || buttonParams
              ? {
                  ...(b.header_media_url ? { headerMediaUrl: b.header_media_url } : {}),
                  ...(buttonParams ? { buttonParams } : {}),
                }
              : undefined,
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
 *
 * Broadcast sem NENHUM destinatário materializado nunca vira 'sent' — isso
 * mascararia um disparo que não aconteceu (envio fantasma). Vira 'failed'.
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
  const final = (total ?? 0) === 0 || failed === total ? "failed" : "sent";
  await admin.from("broadcasts").update({ status: final }).eq("id", broadcastId);
}

/**
 * Materializa destinatários de um broadcast agendado que chegou ao dreno sem
 * nenhuma linha em broadcast_recipients (criado fora da UI — API/SQL). Resolve
 * audience_filter do tipo 'tags' (tagIds - excludeTagIds) e insere os contatos
 * como 'pending'. Idempotente: só roda quando não existe destinatário algum.
 */
async function materializeAudienceIfEmpty(
  admin: Admin,
  broadcastId: string,
): Promise<void> {
  const { count: existing } = await admin
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId);
  if ((existing ?? 0) > 0) return;

  const { data: b } = await admin
    .from("broadcasts")
    .select("id, audience_filter")
    .eq("id", broadcastId)
    .maybeSingle();
  const filter = (b?.audience_filter ?? null) as {
    type?: string;
    tagIds?: string[];
    excludeTagIds?: string[];
  } | null;
  if (!filter || filter.type !== "tags" || !filter.tagIds?.length) return;

  const { data: tagged } = await admin
    .from("contact_tags")
    .select("contact_id, tag_id")
    .in("tag_id", filter.tagIds);
  let contactIds = [...new Set((tagged ?? []).map((r) => r.contact_id as string))];

  if (contactIds.length > 0 && filter.excludeTagIds?.length) {
    const { data: excluded } = await admin
      .from("contact_tags")
      .select("contact_id")
      .in("tag_id", filter.excludeTagIds);
    const excludeSet = new Set((excluded ?? []).map((r) => r.contact_id as string));
    contactIds = contactIds.filter((id) => !excludeSet.has(id));
  }
  if (contactIds.length === 0) return;

  await admin.from("broadcast_recipients").insert(
    contactIds.map((contactId) => ({
      broadcast_id: broadcastId,
      contact_id: contactId,
      status: "pending",
    })),
  );
  await admin
    .from("broadcasts")
    .update({ total_recipients: contactIds.length })
    .eq("id", broadcastId);
}

/**
 * Colunas que o dreno lê de `broadcasts`. As opcionais são as que podem
 * ainda não existir quando o código sobe antes da migration.
 */
const DRAIN_COLUMNS_BASE =
  "id, account_id, channel_id, template_name, template_language, template_variables, status, updated_at";
const DRAIN_COLUMNS_OPTIONAL = "header_media_url";

/**
 * O erro é "essa coluna não existe aqui"? PostgREST devolve PGRST204 com
 * "schema cache" e o Postgres 42703 com "column ... does not exist".
 */
export function isMissingColumnError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("schema cache")) return true;
  return msg.includes("column") && msg.includes("does not exist");
}

/**
 * Lista os broadcasts a drenar SEM deixar que um descompasso entre código
 * e banco silencie a fila inteira.
 *
 * Isto já aconteceu: o deploy subiu com `header_media_url` no select antes
 * da migration rodar. O select passou a falhar, o erro era descartado sem
 * log, e TODA conta parou de disparar — a cadência automática ficou
 * represada horas sem ninguém perceber, porque "nenhum broadcast pendente"
 * e "não consegui ler os broadcasts" pareciam a mesma coisa.
 *
 * Agora uma coluna ausente degrada: seguimos com o conjunto mínimo (sem a
 * mídia do cabeçalho) e gritamos no log, em vez de parar tudo em silêncio.
 */
async function fetchDrainableBroadcasts(
  admin: Admin,
  staleIso: string,
): Promise<(BroadcastRow & { updated_at: string })[]> {
  const run = (columns: string) =>
    admin
      .from("broadcasts")
      .select(columns)
      .eq("status", "sending")
      .or(`scheduled_at.not.is.null,updated_at.lte.${staleIso}`)
      .order("updated_at", { ascending: true })
      .limit(20);

  const full = await run(`${DRAIN_COLUMNS_BASE}, ${DRAIN_COLUMNS_OPTIONAL}`);
  if (!full.error) {
    return (full.data ?? []) as unknown as (BroadcastRow & { updated_at: string })[];
  }

  if (!isMissingColumnError(full.error)) {
    console.error(
      "[broadcast-worker] não consegui listar os disparos pendentes:",
      full.error.message,
    );
    return [];
  }

  console.warn(
    `[broadcast-worker] banco atrás do código (${full.error.message}). ` +
      "Drenando sem a mídia de cabeçalho — rode a migration pendente para " +
      "voltar ao normal.",
  );
  const minimal = await run(DRAIN_COLUMNS_BASE);
  if (minimal.error) {
    console.error(
      "[broadcast-worker] não consegui listar os disparos nem no modo mínimo:",
      minimal.error.message,
    );
    return [];
  }
  return ((minimal.data ?? []) as unknown as Record<string, unknown>[]).map(
    (row) => ({ ...row, header_media_url: null }),
  ) as (BroadcastRow & { updated_at: string })[];
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

  // Agendados vencidos → sending. Se o broadcast chegou aqui sem nenhum
  // destinatário materializado (criado via API/SQL, fora da UI), resolve a
  // audiência por tags antes de promover.
  const { data: dueScheduled, error: dueError } = await admin
    .from("broadcasts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .limit(20);
  if (dueError) {
    // Mesma armadilha de antes: sem log, "deu erro" e "não tinha nada
    // agendado" ficam indistinguíveis e o atraso passa despercebido.
    console.error(
      "[broadcast-worker] não consegui listar os agendados vencidos:",
      dueError.message,
    );
  }
  for (const b of dueScheduled ?? []) {
    await materializeAudienceIfEmpty(admin, b.id);
    await admin.from("broadcasts").update({ status: "sending" }).eq("id", b.id);
  }

  // Candidatos a dreno (status 'sending'):
  //   - scheduled_at NÃO nulo → foi agendado/rascunho promovido pelo worker
  //     (sem cliente ativo) → drena já;
  //   - scheduled_at nulo (é um "Enviar agora" client-side) → só drena se
  //     ficou OCIOSO > 2min (a aba fechou no meio) — takeover, sem colidir
  //     com o cliente que está enviando.
  const sending = await fetchDrainableBroadcasts(admin, staleIso);

  let processed = 0;
  let touched = 0;
  let budget = totalBudget;
  for (const b of sending) {
    if (budget <= 0) break;
    const n = await drainBroadcast(admin, b, Math.min(budget, 40));
    processed += n;
    budget -= n;
    if (n > 0) touched++;
    await finalizeIfDone(admin, b.id);
  }

  return { processed, broadcasts: touched };
}
