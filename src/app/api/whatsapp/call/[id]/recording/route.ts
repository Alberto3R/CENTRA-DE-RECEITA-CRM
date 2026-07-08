import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

/**
 * GET /api/whatsapp/call/[id]/recording — link assinado (1h) da gravação.
 * Membros da conta (a RLS do bucket reforça).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const { data: call } = await ctx.supabase
      .from("whatsapp_calls")
      .select("recording_path")
      .eq("id", id)
      .maybeSingle();
    if (!call?.recording_path) {
      return NextResponse.json({ error: "Sem gravação" }, { status: 404 });
    }

    const { data, error } = await ctx.supabase.storage
      .from("call-recordings")
      .createSignedUrl(call.recording_path, 3600);
    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { error: "Falha ao gerar o link da gravação" },
        { status: 500 },
      );
    }
    return NextResponse.json({ url: data.signedUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}
