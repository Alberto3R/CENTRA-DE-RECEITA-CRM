import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  fromNumber,
  generateWebRtcToken,
  getAvailableCredit,
} from "@/lib/telnyx/calling";

/** Motivo gravado em telnyx_calls.error_message quando falta crédito. */
const SEM_CREDITO = "sem_credito";

/**
 * POST /api/telnyx/token
 *
 * Gera o JWT curto que o softphone (@telnyx/webrtc) usa pra logar. Só um
 * agente autenticado obtém o token — a API key e a senha SIP nunca vão pro
 * navegador. Também devolve o caller id (nosso número) pra discagem.
 *
 * Antes, confere o crédito da conta Telnyx: sem crédito a ligação morre com
 * um erro genérico do SDK, e o vendedor não tem como saber o motivo. Aqui ele
 * recebe o aviso certo antes de discar.
 */
export async function POST() {
  try {
    await requireRole("agent");

    const credit = await getAvailableCredit();
    if (credit !== null && credit <= 0) {
      console.error(`[telnyx/token] sem crédito: available_credit=${credit}`);
      return NextResponse.json(
        {
          error:
            "O crédito de ligações do CRM acabou. Avise o administrador para recarregar.",
          code: SEM_CREDITO,
        },
        { status: 402 },
      );
    }

    const token = await generateWebRtcToken();
    return NextResponse.json({ token, from: fromNumber() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
