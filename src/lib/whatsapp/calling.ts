/**
 * WhatsApp Business Calling API — wrappers da Graph API.
 *
 * Fluxo business-initiated (ver docs Meta "business-initiated-calls"):
 *   1) `initiateCall` → POST /{PNID}/calls action=connect + SDP offer
 *      (gerado no navegador do SDR). Retorna o wa_call_id.
 *   2) Meta responde por WEBHOOK (field "calls") com o SDP answer; o
 *      handler grava em whatsapp_calls.answer_sdp e o softphone aplica.
 *   3) `terminateCall` → POST /{PNID}/calls action=terminate.
 *
 * Pré-requisitos p/ funcionar em produção (não são código):
 *   - número no Cloud API (ok), calling ENABLED nas settings,
 *   - app inscrito no campo de webhook "calls",
 *   - permissão de chamada do usuário (permission request),
 *   - tier de mensagens >= 2.000/dia.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export interface InitiateCallResult {
  ok: boolean;
  waCallId?: string;
  errorCode?: number;
  errorMessage?: string;
}

/** POST /{PNID}/calls action=connect — inicia a chamada com o SDP offer. */
export async function initiateCall(opts: {
  phoneNumberId: string;
  accessToken: string;
  to: string; // telefone do usuário (dígitos, com DDI)
  sdpOffer: string; // SDP RFC 8866 gerado pelo RTCPeerConnection do navegador
  bizData?: string; // biz_opaque_callback_data (tracking) — máx 512 chars
}): Promise<InitiateCallResult> {
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to: opts.to,
    action: "connect",
    session: { sdp_type: "offer", sdp: opts.sdpOffer },
  };
  if (opts.bizData) body.biz_opaque_callback_data = opts.bizData.slice(0, 512);

  const res = await fetch(`${GRAPH}/${opts.phoneNumberId}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    calls?: { id: string }[];
    error?: { code?: number; message?: string };
  };
  if (!res.ok || !json.calls?.[0]?.id) {
    return {
      ok: false,
      errorCode: json.error?.code,
      // 138006 = falta permissão de chamada do usuário.
      errorMessage: json.error?.message ?? `HTTP ${res.status}`,
    };
  }
  return { ok: true, waCallId: json.calls[0].id };
}

/** POST /{PNID}/calls action=terminate — encerra a chamada. */
export async function terminateCall(opts: {
  phoneNumberId: string;
  accessToken: string;
  waCallId: string;
}): Promise<{ ok: boolean; errorMessage?: string }> {
  const res = await fetch(`${GRAPH}/${opts.phoneNumberId}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      call_id: opts.waCallId,
      action: "terminate",
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    return { ok: false, errorMessage: j.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

/**
 * Aceita uma chamada entrante (USER_INITIATED). Envia o SDP answer gerado
 * pelo softphone. A doc recomenda pre_accept antes do accept p/ evitar
 * clipping de áudio; fazemos ambos com o mesmo answer (o accept exige que
 * o answer bata com o do pre_accept).
 */
export async function acceptCall(opts: {
  phoneNumberId: string;
  accessToken: string;
  waCallId: string;
  sdpAnswer: string;
}): Promise<{ ok: boolean; errorMessage?: string }> {
  const post = (action: "pre_accept" | "accept") =>
    fetch(`${GRAPH}/${opts.phoneNumberId}/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        call_id: opts.waCallId,
        action,
        session: { sdp_type: "answer", sdp: opts.sdpAnswer },
      }),
    });

  // pre_accept é best-effort (estabelece o caminho de mídia cedo).
  await post("pre_accept").catch(() => null);
  const res = await post("accept");
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    return { ok: false, errorMessage: j.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

/** Rejeita uma chamada entrante. */
export async function rejectCall(opts: {
  phoneNumberId: string;
  accessToken: string;
  waCallId: string;
}): Promise<{ ok: boolean; errorMessage?: string }> {
  const res = await fetch(`${GRAPH}/${opts.phoneNumberId}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      call_id: opts.waCallId,
      action: "reject",
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    return { ok: false, errorMessage: j.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

/**
 * Envia um pedido de permissão de chamada em texto livre (só funciona
 * dentro da janela de atendimento de 24h). Fora dela, use um template de
 * permissão. Sem permissão aprovada, `initiateCall` retorna erro 138006.
 */
export async function sendCallPermissionRequest(opts: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  bodyText?: string;
}): Promise<{ ok: boolean; errorMessage?: string }> {
  const res = await fetch(`${GRAPH}/${opts.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: opts.to,
      type: "interactive",
      interactive: {
        type: "call_permission_request",
        body: {
          text:
            opts.bodyText ??
            "Podemos te ligar aqui pelo WhatsApp para falar sobre a sua solicitação?",
        },
        action: { name: "call_permission_request" },
      },
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    return { ok: false, errorMessage: j.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}
