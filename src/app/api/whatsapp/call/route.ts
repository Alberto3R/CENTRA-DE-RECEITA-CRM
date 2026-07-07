import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  initiateCall,
  terminateCall,
  sendCallPermissionRequest,
  acceptCall,
  rejectCall,
} from "@/lib/whatsapp/calling";

/**
 * POST /api/whatsapp/call
 *
 * Duas ações (campo `action`):
 *   - "initiate" (padrão): recebe o SDP offer do softphone e dispara a
 *     chamada via Calling API. Cria a linha em whatsapp_calls (o webhook
 *     depois grava o answer_sdp nela → Realtime → navegador).
 *   - "terminate": encerra a chamada (por id da linha).
 *
 * O áudio é WebRTC ponta-a-ponta navegador<->WhatsApp; aqui só trafega
 * sinalização.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      callId?: string; // id da linha whatsapp_calls (para terminate)
      contactId?: string;
      dealId?: string;
      to?: string;
      sdp?: string;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "payload inválido" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // Config WhatsApp da conta (token + phone_number_id).
    const { data: config } = await admin
      .from("whatsapp_config")
      .select("phone_number_id, access_token, status")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!config?.phone_number_id || !config?.access_token) {
      return NextResponse.json(
        { error: "WhatsApp não conectado nesta conta." },
        { status: 400 },
      );
    }
    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch {
      return NextResponse.json(
        { error: "Token do WhatsApp não pôde ser descriptografado." },
        { status: 500 },
      );
    }

    // ---- TERMINATE ----
    if (body.action === "terminate") {
      if (!body.callId) {
        return NextResponse.json(
          { error: "callId é obrigatório" },
          { status: 400 },
        );
      }
      const { data: row } = await admin
        .from("whatsapp_calls")
        .select("id, wa_call_id, account_id")
        .eq("id", body.callId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!row) {
        return NextResponse.json(
          { error: "chamada não encontrada" },
          { status: 404 },
        );
      }
      if (row.wa_call_id) {
        await terminateCall({
          phoneNumberId: config.phone_number_id,
          accessToken,
          waCallId: row.wa_call_id,
        });
      }
      await admin
        .from("whatsapp_calls")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      return NextResponse.json({ ok: true });
    }

    // ---- ACCEPT / REJECT (chamadas entrantes) ----
    if (body.action === "accept" || body.action === "reject") {
      if (!body.callId) {
        return NextResponse.json(
          { error: "callId é obrigatório" },
          { status: 400 },
        );
      }
      const { data: row } = await admin
        .from("whatsapp_calls")
        .select("id, wa_call_id")
        .eq("id", body.callId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!row?.wa_call_id) {
        return NextResponse.json(
          { error: "chamada não encontrada" },
          { status: 404 },
        );
      }

      if (body.action === "reject") {
        await rejectCall({
          phoneNumberId: config.phone_number_id,
          accessToken,
          waCallId: row.wa_call_id,
        });
        await admin
          .from("whatsapp_calls")
          .update({ status: "rejected", updated_at: new Date().toISOString() })
          .eq("id", row.id);
        return NextResponse.json({ ok: true });
      }

      // accept — precisa do SDP answer gerado no navegador
      if (!body.sdp) {
        return NextResponse.json(
          { error: "sdp (answer) é obrigatório" },
          { status: 400 },
        );
      }
      const acc = await acceptCall({
        phoneNumberId: config.phone_number_id,
        accessToken,
        waCallId: row.wa_call_id,
        sdpAnswer: body.sdp,
      });
      if (!acc.ok) {
        await admin
          .from("whatsapp_calls")
          .update({
            status: "failed",
            error_message: acc.errorMessage ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        return NextResponse.json(
          { error: acc.errorMessage ?? "falha ao aceitar" },
          { status: 400 },
        );
      }
      await admin
        .from("whatsapp_calls")
        .update({ status: "in_progress", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      return NextResponse.json({ ok: true });
    }

    // ---- REQUEST PERMISSION ----
    // Envia o pedido de permissão de chamada ao lead. Sem permissão
    // aprovada, initiate retorna 138006.
    if (body.action === "request_permission") {
      let toPhone = body.to ?? null;
      if (body.contactId) {
        const { data: contact } = await ctx.supabase
          .from("contacts")
          .select("phone")
          .eq("id", body.contactId)
          .maybeSingle();
        if (contact?.phone) toPhone = contact.phone;
      }
      if (!toPhone) {
        return NextResponse.json(
          { error: "destino (contactId ou to) é obrigatório" },
          { status: 400 },
        );
      }
      const r = await sendCallPermissionRequest({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: toPhone.replace(/\D/g, ""),
      });
      if (!r.ok) {
        return NextResponse.json(
          { error: r.errorMessage ?? "falha ao pedir permissão" },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ---- INITIATE ----
    if (!body.sdp) {
      return NextResponse.json(
        { error: "sdp (offer) é obrigatório" },
        { status: 400 },
      );
    }

    // Resolve o número de destino: pelo contato (preferido) ou `to` cru.
    let toPhone = body.to ?? null;
    let contactId = body.contactId ?? null;
    if (contactId) {
      const { data: contact } = await ctx.supabase
        .from("contacts")
        .select("id, phone")
        .eq("id", contactId)
        .maybeSingle();
      if (!contact?.phone) {
        return NextResponse.json(
          { error: "contato sem telefone" },
          { status: 400 },
        );
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
    const to = toPhone.replace(/\D/g, "");

    // Cria a linha primeiro (status 'initiating') p/ ter o id de tracking.
    const { data: row, error: insErr } = await admin
      .from("whatsapp_calls")
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        contact_id: contactId,
        deal_id: body.dealId ?? null,
        direction: "BUSINESS_INITIATED",
        status: "initiating",
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

    const result = await initiateCall({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to,
      sdpOffer: body.sdp,
      bizData: row.id,
    });

    if (!result.ok) {
      await admin
        .from("whatsapp_calls")
        .update({
          status: "failed",
          error_code: result.errorCode ?? null,
          error_message: result.errorMessage ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      // 138006 = sem permissão de chamada do usuário → sinaliza pro front.
      return NextResponse.json(
        {
          error: result.errorMessage ?? "falha ao iniciar chamada",
          code: result.errorCode ?? null,
          needsPermission: result.errorCode === 138006,
        },
        { status: 400 },
      );
    }

    await admin
      .from("whatsapp_calls")
      .update({
        wa_call_id: result.waCallId,
        status: "ringing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    return NextResponse.json({
      id: row.id,
      waCallId: result.waCallId,
      status: "ringing",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
