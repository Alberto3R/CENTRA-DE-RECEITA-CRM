import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { verifyTelnyxSignature } from "@/lib/telnyx/calling";
import { handleTelnyxWebhook, type TelnyxWebhookEvent } from "@/lib/telnyx/webhook";

/**
 * POST /api/telnyx/webhook
 *
 * Recebe os eventos de Call Control do Telnyx (call.initiated/answered/hangup,
 * call.recording.saved). Verifica a assinatura Ed25519 e atualiza `telnyx_calls`
 * via service_role (ignora RLS). Sempre responde rápido; erros do handler não
 * derrubam o ack (evita retry storm), mas assinatura inválida = 401.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const sig = request.headers.get("telnyx-signature-ed25519");
  const ts = request.headers.get("telnyx-timestamp");

  if (!verifyTelnyxSignature(raw, sig, ts)) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let event: TelnyxWebhookEvent;
  try {
    event = JSON.parse(raw) as TelnyxWebhookEvent;
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }

  try {
    await handleTelnyxWebhook(event, supabaseAdmin());
  } catch (e) {
    console.error("[telnyx] webhook handler falhou:", e);
  }
  return NextResponse.json({ ok: true });
}
