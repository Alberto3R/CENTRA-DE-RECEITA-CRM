import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { fromNumber, generateWebRtcToken } from "@/lib/telnyx/calling";

/**
 * POST /api/telnyx/token
 *
 * Gera o JWT curto que o softphone (@telnyx/webrtc) usa pra logar. Só um
 * agente autenticado obtém o token — a API key e a senha SIP nunca vão pro
 * navegador. Também devolve o caller id (nosso número) pra discagem.
 */
export async function POST() {
  try {
    await requireRole("agent");
    const token = await generateWebRtcToken();
    return NextResponse.json({ token, from: fromNumber() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
