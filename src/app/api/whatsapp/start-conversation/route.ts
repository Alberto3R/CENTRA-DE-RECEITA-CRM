import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * POST /api/whatsapp/start-conversation
 *
 * Acha ou cria a conversa de um contato na conta e devolve o
 * `conversationId`. Necessário para iniciar uma conversa a partir do card
 * de negócio (lead importado sem conversa prévia) e então enviar um
 * template pelo /api/whatsapp/send (que exige conversation_id).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as {
      contactId?: string;
    } | null;
    if (!body?.contactId) {
      return NextResponse.json(
        { error: "contactId é obrigatório" },
        { status: 400 },
      );
    }

    // Confirma que o contato é da conta (via RLS).
    const { data: contact } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("id", body.contactId)
      .maybeSingle();
    if (!contact) {
      return NextResponse.json(
        { error: "contato não encontrado" },
        { status: 404 },
      );
    }

    const admin = supabaseAdmin();
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("contact_id", contact.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ conversationId: existing.id });
    }

    const { data: created, error } = await admin
      .from("conversations")
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        contact_id: contact.id,
      })
      .select("id")
      .single();
    if (error || !created) {
      return NextResponse.json(
        { error: "falha ao criar conversa" },
        { status: 500 },
      );
    }
    return NextResponse.json({ conversationId: created.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
