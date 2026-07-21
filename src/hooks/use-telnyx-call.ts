"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TelnyxRTC } from "@telnyx/webrtc";

/**
 * Softphone Telnyx (ligação PSTN direta ao telefone do lead) — WebRTC no
 * navegador via SDK @telnyx/webrtc.
 *
 * Fluxo:
 *   1) POST /api/telnyx/call (log) → { id, from, to, clientState }
 *   2) POST /api/telnyx/token → JWT curto do softphone
 *   3) new TelnyxRTC({ login_token }) → connect → telnyx.ready
 *   4) client.newCall({ destinationNumber, callerNumber, clientState }) — o SDK
 *      faz TODA a sinalização/mídia direto com o Telnyx; o áudio (call.remoteStream)
 *      é atacado no <audio ref={remoteAudioRef} autoPlay />
 *   5) estado da chamada vem dos eventos telnyx.notification (callUpdate)
 *
 * O clientState (base64 do telnyx_calls.id) volta nos webhooks de Call Control,
 * casando a linha pro log de status/gravação. Nenhuma mídia passa pelo backend.
 */

export type TelnyxCallStatus =
  | "idle"
  | "connecting"
  | "ringing"
  | "in_progress"
  | "ended"
  | "failed";

interface StartOpts {
  contactId?: string;
  dealId?: string;
  to?: string;
}

// Tipos frouxos do SDK (evita acoplar à versão exata).
type TelnyxCall = {
  state: string;
  remoteStream?: MediaStream | null;
  hangup: () => void;
};
type TelnyxNotification = { type?: string; call?: TelnyxCall };

export function useTelnyxCall() {
  const [status, setStatus] = useState<TelnyxCallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (status !== "in_progress") {
      if (status === "idle" || status === "ended" || status === "failed")
        setSeconds(0);
      return;
    }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const clientRef = useRef<InstanceType<typeof TelnyxRTC> | null>(null);
  const callRef = useRef<TelnyxCall | null>(null);
  const callRowIdRef = useRef<string | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    try {
      callRef.current?.hangup?.();
    } catch {
      /* noop */
    }
    callRef.current = null;
    try {
      clientRef.current?.disconnect?.();
    } catch {
      /* noop */
    }
    clientRef.current = null;
    callRowIdRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startCall = useCallback(
    async (opts: StartOpts) => {
      setError(null);
      cleanup();
      setStatus("connecting");

      // 1) registra a chamada (log) + resolve destino/caller
      let logged: {
        id?: string;
        from?: string;
        to?: string;
        clientState?: string;
        error?: string;
      };
      try {
        const res = await fetch("/api/telnyx/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "initiate", ...opts }),
        });
        logged = await res.json();
        if (!res.ok || !logged.id || !logged.to || !logged.from) {
          setError(logged.error ?? "Falha ao iniciar a chamada.");
          setStatus("failed");
          return;
        }
      } catch {
        setError("Falha de rede ao iniciar a chamada.");
        setStatus("failed");
        return;
      }
      callRowIdRef.current = logged.id;

      // 2) token do softphone
      let token: string;
      try {
        const res = await fetch("/api/telnyx/token", { method: "POST" });
        const data = (await res.json()) as { token?: string; error?: string };
        if (!res.ok || !data.token) {
          setError(data.error ?? "Falha ao autenticar o softphone.");
          setStatus("failed");
          await markFail(logged.id, data.error);
          return;
        }
        token = data.token;
      } catch {
        setError("Falha de rede ao autenticar o softphone.");
        setStatus("failed");
        await markFail(logged.id);
        return;
      }

      // 3) SDK: conecta e disca
      const client = new TelnyxRTC({ login_token: token });
      clientRef.current = client;

      client.on("telnyx.notification", (n: TelnyxNotification) => {
        if (n.type !== "callUpdate" || !n.call) return;
        const call = n.call;
        callRef.current = call;
        // ata o áudio do lead
        if (call.remoteStream && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = call.remoteStream;
        }
        switch (call.state) {
          case "new":
          case "requesting":
          case "trying":
          case "early":
          case "ringing":
            setStatus("ringing");
            break;
          case "active":
            setStatus("in_progress");
            break;
          case "hangup":
          case "destroy":
            setStatus((s) => (s === "failed" ? s : "ended"));
            cleanup();
            break;
        }
      });

      client.on("telnyx.error", () => {
        setError("Erro na conexão do softphone.");
        setStatus("failed");
        void markFail(callRowIdRef.current, "telnyx.error");
        cleanup();
      });

      client.on("telnyx.ready", () => {
        try {
          const call = client.newCall({
            destinationNumber: logged.to!,
            callerNumber: logged.from!,
            clientState: logged.clientState,
            audio: true,
            video: false,
          }) as unknown as TelnyxCall;
          callRef.current = call;
          setStatus("ringing");
        } catch (e) {
          setError("Falha ao discar.");
          setStatus("failed");
          void markFail(callRowIdRef.current, String(e));
          cleanup();
        }
      });

      client.connect();
    },
    [cleanup],
  );

  const hangup = useCallback(async () => {
    const id = callRowIdRef.current;
    setStatus((s) => (s === "in_progress" || s === "ringing" ? "ended" : s));
    try {
      callRef.current?.hangup?.();
    } catch {
      /* noop */
    }
    if (id) {
      try {
        await fetch("/api/telnyx/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "hangup", callId: id }),
        });
      } catch {
        /* best-effort */
      }
    }
    cleanup();
  }, [cleanup]);

  return { status, error, seconds, startCall, hangup, remoteAudioRef };
}

async function markFail(callId?: string | null, errorMessage?: string) {
  if (!callId) return;
  try {
    await fetch("/api/telnyx/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fail", callId, errorMessage }),
    });
  } catch {
    /* best-effort */
  }
}
