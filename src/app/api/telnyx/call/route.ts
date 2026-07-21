import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { fromNumber, hangupCall } from "@/lib/telnyx/calling";

/**
 * POST /api/telnyx/call
 *
 * O softphone (@telnyx/webrtc) disca DIRETO com o Telnyx; esta rota só faz o
 * LOG/estado no CRM.
 *
 * Ações (campo `action`):
 *   - "initiate" (padrão): cria a linha em telnyx_calls (status 'initiating')
 *     ANTES de discar e devolve { id, from, clientState }. O front passa o
 *     clientState (base64 do id) no `new call` do SDK → o webhook casa a linha.
 *   - "hangup": encerra pela Call Control (usa o call_control_id da linha).
 *   - "fail": marca a linha como falha (erro local do SDK antes de qualquer webhook).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      callId?: string; // id da linha telnyx_calls
      contactId?: string;
      dealId?: string;
      to?: string;
      errorMessage?: string;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "payload inválido" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // ---- HANGUP ----
    if (body.action === "hangup") {
      if (!body.callId) {
        return NextResponse.json({ error: "callId é obrigatório" }, { status: 400 });
      }
      const { data: row } = await admin
        .from("telnyx_calls")
        .select("id, call_control_id")
        .eq("id", body.callId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!row) {
        return NextResponse.json({ error: "chamada não encontrada" }, { status: 404 });
      }
      if (row.call_control_id) await hangupCall(row.call_control_id);
      await admin
        .from("telnyx_calls")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      return NextResponse.json({ ok: true });
    }

    // ---- FAIL (erro local do softphone) ----
    if (body.action === "fail") {
      if (!body.callId) {
        return NextResponse.json({ error: "callId é obrigatório" }, { status: 400 });
      }
      await admin
        .from("telnyx_calls")
        .update({
          status: "failed",
          error_message: body.errorMessage ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.callId)
        .eq("account_id", ctx.accountId);
      return NextResponse.json({ ok: true });
    }

    // ---- INITIATE (log) ----
    let toPhone = body.to ?? null;
    let contactId = body.contactId ?? null;
    if (contactId) {
      const { data: contact } = await ctx.supabase
        .from("contacts")
        .select("id, phone")
        .eq("id", contactId)
        .maybeSingle();
      if (!contact?.phone) {
        return NextResponse.json({ error: "contato sem telefone" }, { status: 400 });
      }
      toPhone = contact.phone;
      contactId = contact.id;
    }
    if (!toPhone) {
      return NextResponse.json(
        { error: "destino (contactId ou to) é obrigatório" },
        { status: 400 },
      );
    }
    // E.164 com DDI Brasil quando vier sem +
    const digits = toPhone.replace(/\D/g, "");
    const to = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;

    const { data: row, error: insErr } = await admin
      .from("telnyx_calls")
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        contact_id: contactId,
        deal_id: body.dealId ?? null,
        direction: "outbound",
        status: "initiating",
        from_phone: fromNumber(),
        to_phone: to,
      })
      .select("id")
      .single();
    if (insErr || !row) {
      return NextResponse.json(
        { error: "falha ao registrar a chamada" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      id: row.id,
      from: fromNumber(),
      to,
      // o front passa isto como client_state no new call do @telnyx/webrtc
      clientState: Buffer.from(row.id).toString("base64"),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
