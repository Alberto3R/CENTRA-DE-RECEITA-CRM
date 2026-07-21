/**
 * Telnyx — ligação PSTN (discador WebRTC no navegador).
 *
 * Wrappers da API v2 do Telnyx (https://developers.telnyx.com) + verificação
 * de assinatura do webhook. Diferente da ligação WhatsApp (calling.ts do
 * whatsapp, que relaya SDP via nosso banco), aqui o SDK @telnyx/webrtc no
 * navegador faz TODA a sinalização direto com o Telnyx. O backend só:
 *   1) gera o token JWT curto que o softphone usa pra logar (generateWebRtcToken);
 *   2) recebe eventos de Call Control no webhook (pra logar status/gravação);
 *   3) opcionalmente comanda a chamada (record_start / hangup).
 *
 * Envs (Vercel + doc de credenciais):
 *   TELNYX_API_KEY                    — chave v2 (KEY...)
 *   TELNYX_TELEPHONY_CREDENTIAL_ID    — credential p/ mintar o JWT do softphone
 *   TELNYX_CONNECTION_ID              — credential connection (WebRTC)
 *   TELNYX_FROM_NUMBER               — caller id (nosso número, ex +556236029411)
 *   TELNYX_PUBLIC_KEY                 — chave pública Ed25519 (verificação do webhook)
 */

import crypto from "node:crypto";

const API = "https://api.telnyx.com/v2";

function apiKey(): string {
  const k = process.env.TELNYX_API_KEY;
  if (!k) throw new Error("TELNYX_API_KEY ausente");
  return k;
}

/** Número que aparece como caller id (dígitos com DDI, formato E.164). */
export function fromNumber(): string {
  const n = process.env.TELNYX_FROM_NUMBER;
  if (!n) throw new Error("TELNYX_FROM_NUMBER ausente");
  return n.startsWith("+") ? n : `+${n}`;
}

/**
 * POST /v2/telephony_credentials/{id}/token — devolve um JWT curto (texto puro)
 * que o @telnyx/webrtc usa em `new TelnyxRTC({ login_token })`. Nunca expõe a
 * API key nem a senha SIP no navegador.
 */
export async function generateWebRtcToken(): Promise<string> {
  const credId = process.env.TELNYX_TELEPHONY_CREDENTIAL_ID;
  if (!credId) throw new Error("TELNYX_TELEPHONY_CREDENTIAL_ID ausente");
  const res = await fetch(`${API}/telephony_credentials/${credId}/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const text = (await res.text()).trim();
  if (!res.ok || !text) {
    throw new Error(`falha ao gerar token Telnyx: HTTP ${res.status} ${text}`);
  }
  return text;
}

/** Call Control: inicia gravação dual-channel. Best-effort. */
export async function startRecording(callControlId: string): Promise<void> {
  await fetch(`${API}/calls/${callControlId}/actions/record_start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ format: "mp3", channels: "dual" }),
  }).catch(() => null);
}

/** Call Control: encerra a chamada pelo call_control_id. */
export async function hangupCall(
  callControlId: string,
): Promise<{ ok: boolean; errorMessage?: string }> {
  const res = await fetch(`${API}/calls/${callControlId}/actions/hangup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      errors?: Array<{ detail?: string }>;
    };
    return { ok: false, errorMessage: j.errors?.[0]?.detail ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

/**
 * Verifica a assinatura Ed25519 do webhook do Telnyx.
 * Headers: `telnyx-signature-ed25519` (base64) + `telnyx-timestamp`.
 * O conteúdo assinado é `${timestamp}|${rawBody}`.
 *
 * A chave pública do Telnyx vem em base64 (32 bytes raw); embrulhamos no
 * prefixo SPKI DER do Ed25519 pra montar o KeyObject do Node.
 */
export function verifyTelnyxSignature(
  rawBody: string,
  signatureB64: string | null,
  timestamp: string | null,
): boolean {
  const pubB64 = process.env.TELNYX_PUBLIC_KEY;
  // Sem chave configurada não conseguimos verificar — recusa por segurança.
  if (!pubB64 || !signatureB64 || !timestamp) return false;
  try {
    const raw = Buffer.from(pubB64, "base64");
    if (raw.length !== 32) return false;
    // Prefixo SPKI DER de uma chave pública Ed25519 (RFC 8410).
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      raw,
    ]);
    const key = crypto.createPublicKey({
      key: der,
      format: "der",
      type: "spki",
    });
    const signed = Buffer.from(`${timestamp}|${rawBody}`);
    const sig = Buffer.from(signatureB64, "base64");
    return crypto.verify(null, signed, key, sig);
  } catch {
    return false;
  }
}
