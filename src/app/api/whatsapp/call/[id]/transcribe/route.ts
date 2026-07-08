import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { transcribeAudio } from "@/lib/ai/transcribe";

/**
 * POST /api/whatsapp/call/[id]/transcribe — transcreve a gravação da chamada
 * (Whisper) e salva em whatsapp_calls.transcript. Idempotente: se já houver
 * transcrição, devolve a existente. Admin+ (é função de gestão).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;
    const admin = supabaseAdmin();

    const { data: call } = await admin
      .from("whatsapp_calls")
      .select("id, account_id, recording_path, transcript")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!call) {
      return NextResponse.json({ error: "Chamada não encontrada" }, { status: 404 });
    }
    if (call.transcript) {
      return NextResponse.json({ transcript: call.transcript, cached: true });
    }
    if (!call.recording_path) {
      return NextResponse.json({ error: "Chamada sem gravação" }, { status: 404 });
    }

    const { data: file, error: dlErr } = await admin.storage
      .from("call-recordings")
      .download(call.recording_path);
    if (dlErr || !file) {
      return NextResponse.json(
        { error: "Falha ao baixar a gravação" },
        { status: 500 },
      );
    }

    let transcript: string;
    try {
      transcript = await transcribeAudio(file, "call.webm");
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Falha na transcrição" },
        { status: 400 },
      );
    }

    await admin
      .from("whatsapp_calls")
      .update({ transcript, transcribed_at: new Date().toISOString() })
      .eq("id", call.id);

    return NextResponse.json({ transcript });
  } catch (err) {
    return toErrorResponse(err);
  }
}
