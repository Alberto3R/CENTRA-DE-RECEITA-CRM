// POST /api/whatsapp/broadcast/[id]/send
//
// Envia um disparo em RASCUNHO (status 'draft'): resolve o público a partir do
// audience_filter salvo, cria os destinatários (pending), marca 'scheduled'
// (agora) e dreno na hora via worker. O cron finaliza o que sobrar. Reusa a
// mesma mecânica de envio já validada. CSV não é reenviável (público sintético).

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { processDueBroadcasts } from "@/lib/broadcast/worker";
import { selectAllPages, selectInChunks } from "@/lib/supabase/in-chunks";

type Admin = ReturnType<typeof supabaseAdmin>;

interface AudienceFilter {
  type?: string;
  tagIds?: string[];
  excludeTagIds?: string[];
  customField?: { fieldId: string; operator: string; value: string };
}

async function resolveContactIds(
  admin: Admin,
  accountId: string,
  af: AudienceFilter,
): Promise<string[]> {
  // Toda leitura aqui é paginada ou em lotes (ver in-chunks.ts): sem isso a
  // conferência dos contatos com 697 IDs voltava 400 e o disparo saía para
  // ZERO pessoas, sem erro nenhum na tela.
  const fail = (what: string, error: { message: string }) => {
    throw new Error(`Falha ao montar o público (${what}): ${error.message}`);
  };
  let ids: string[] = [];

  if (af.type === "all") {
    const { data, error } = await selectAllPages<{ id: string }>((from, to) =>
      admin
        .from("contacts")
        .select("id")
        .eq("account_id", accountId)
        .order("id")
        .range(from, to),
    );
    if (error) fail("contatos", error);
    ids = data.map((c) => c.id);
  } else if (af.type === "tags" && af.tagIds && af.tagIds.length > 0) {
    const tagIds = af.tagIds;
    const { data, error } = await selectAllPages<{ contact_id: string }>(
      (from, to) =>
        admin
          .from("contact_tags")
          .select("contact_id")
          .in("tag_id", tagIds)
          .order("contact_id")
          .range(from, to),
    );
    if (error) fail("etiquetas", error);
    ids = [...new Set(data.map((r) => r.contact_id))];
  } else if (af.type === "custom_field" && af.customField) {
    const { fieldId, operator, value } = af.customField;
    const { data, error } = await selectAllPages<{ contact_id: string }>(
      (from, to) => {
        let q = admin
          .from("contact_custom_values")
          .select("contact_id")
          .eq("custom_field_id", fieldId);
        if (operator === "is") q = q.eq("value", value);
        else if (operator === "is_not") q = q.neq("value", value);
        else if (operator === "contains") q = q.ilike("value", `%${value}%`);
        return q.order("contact_id").range(from, to);
      },
    );
    if (error) fail("campo personalizado", error);
    ids = [...new Set(data.map((r) => r.contact_id))];
  }

  // Confere que os contatos são da conta (segurança) e aplica exclusão.
  if (ids.length > 0) {
    const { data: valid, error } = await selectInChunks<{ id: string }>(
      ids,
      (slice) =>
        admin.from("contacts").select("id").eq("account_id", accountId).in("id", slice),
    );
    if (error) fail("conferência dos contatos", error);
    ids = valid.map((c) => c.id);
  }
  if (af.excludeTagIds && af.excludeTagIds.length > 0 && ids.length > 0) {
    const excludeTagIds = af.excludeTagIds;
    const { data: ex, error } = await selectAllPages<{ contact_id: string }>(
      (from, to) =>
        admin
          .from("contact_tags")
          .select("contact_id")
          .in("tag_id", excludeTagIds)
          .order("contact_id")
          .range(from, to),
    );
    // Sem a lista de exclusão, o disparo iria para quem pediu para sair.
    if (error) fail("etiquetas de exclusão", error);
    const exclude = new Set(ex.map((r) => r.contact_id));
    ids = ids.filter((id) => !exclude.has(id));
  }
  return ids;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const admin = supabaseAdmin();

    const { data: b } = await admin
      .from("broadcasts")
      .select("id, account_id, status, audience_filter")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!b) {
      return NextResponse.json({ error: "Disparo não encontrado." }, { status: 404 });
    }
    if (b.status !== "draft") {
      return NextResponse.json(
        { error: "Só rascunhos podem ser enviados por aqui." },
        { status: 400 },
      );
    }
    const af = (b.audience_filter ?? {}) as AudienceFilter;
    if (af.type === "csv") {
      return NextResponse.json(
        { error: "Rascunho de CSV não pode ser reenviado — recrie o disparo." },
        { status: 400 },
      );
    }

    let contactIds: string[];
    try {
      contactIds = await resolveContactIds(admin, ctx.accountId, af);
    } catch (e) {
      // Erro de leitura: nunca segue com o público pela metade.
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Falha ao montar o público." },
        { status: 500 },
      );
    }
    if (contactIds.length === 0) {
      return NextResponse.json(
        { error: "Nenhum contato no público deste rascunho." },
        { status: 400 },
      );
    }

    // Cria destinatários (pending). Em lotes.
    const rows = contactIds.map((cid) => ({
      broadcast_id: id,
      contact_id: cid,
      status: "pending" as const,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin
        .from("broadcast_recipients")
        .insert(rows.slice(i, i + 200));
      if (error) {
        return NextResponse.json(
          { error: `Falha ao criar destinatários: ${error.message}` },
          { status: 500 },
        );
      }
    }

    // Marca agendado-para-agora → o worker (e o dreno inline abaixo) envia.
    await admin
      .from("broadcasts")
      .update({
        status: "scheduled",
        scheduled_at: new Date().toISOString(),
        total_recipients: contactIds.length,
      })
      .eq("id", id);

    // Dreno imediato (o cron cobre o que exceder o orçamento desta request).
    const result = await processDueBroadcasts();

    return NextResponse.json({ ok: true, total: contactIds.length, ...result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
