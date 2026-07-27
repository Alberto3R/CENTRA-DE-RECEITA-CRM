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
  // Guardas contra o loop de re-discagem/reconexão do SDK:
  //   endedRef  = já encerramos → TODOS os handlers viram no-op (nada re-processa)
  //   dialedRef = já discamos 1x nesta sessão → telnyx.ready não disca de novo
  //             (o SDK reconecta sozinho e re-emite ready; sem isso, re-disca em loop)
  const endedRef = useRef(false);
  const dialedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Registro da chamada no CRM a partir do CLIENTE (a connection WebRTC não
  // dispara webhook): quando atendeu e por quanto tempo falou.
  const answeredAtRef = useRef<number | null>(null);
  const reportedRef = useRef(false); // garante 1 report de "completed" só

  // Solta os recursos SEM chamar call.hangup(). Chamar hangup() aqui — dentro
  // do handler das notificações de 'hangup'/'destroy' — causava RECURSÃO
  // INFINITA (hangup → notificação → setState → hangup → …) que estourava a
  // pilha ("Maximum call stack size exceeded") e CRASHAVA a aba. O hangup ATIVO
  // do SDK fica exclusivamente no hangup() do usuário (botão Encerrar). O
  // disconnect() do client já derruba a chamada no transporte.
  const cleanup = useCallback(() => {
    endedRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
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
      // nova tentativa: rearma as guardas
      endedRef.current = false;
      dialedRef.current = false;
      answeredAtRef.current = null;
      reportedRef.current = false;
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

      // 2b) GARANTE o microfone ANTES de discar. Sem permissão de mic, o SDK
      // cria a chamada mas ela morre na hora (sem tocar/sem áudio) — provável
      // causa do "não chamou nada". Aqui o prompt aparece e, se negado, avisa.
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
      } catch {
        setError("Permita o acesso ao microfone do navegador para ligar.");
        setStatus("failed");
        await markFail(logged.id, "mic_denied");
        return;
      }

      // 3) SDK: conecta e disca
      const client = new TelnyxRTC({ login_token: token });
      clientRef.current = client;

      client.on("telnyx.notification", (n: TelnyxNotification) => {
        if (n.type !== "callUpdate" || !n.call) return;
        // Já encerrado → ignora notificações residuais (mata o loop de re-processo).
        if (endedRef.current) return;
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
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            answeredAtRef.current = Date.now();
            setStatus("in_progress");
            void reportUpdate(callRowIdRef.current, "answered");
            break;
          case "hangup":
          case "destroy": {
            const rowId = callRowIdRef.current;
            const dur = answeredAtRef.current
              ? Math.round((Date.now() - answeredAtRef.current) / 1000)
              : 0;
            setStatus((s) => (s === "failed" ? s : "ended"));
            finishReport(reportedRef, rowId, dur);
            cleanup();
            break;
          }
        }
      });

      client.on("telnyx.error", () => {
        if (endedRef.current) return;
        setError("Erro na conexão do softphone.");
        setStatus("failed");
        void markFail(callRowIdRef.current, "telnyx.error");
        cleanup();
      });

      client.on("telnyx.ready", () => {
        // Disca UMA vez. O SDK reconecta sozinho e re-emite ready; sem estas
        // guardas, cada re-ready disparava outra chamada → loop de discagem.
        if (endedRef.current || dialedRef.current) return;
        dialedRef.current = true;
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

      // Trava de segurança: se não atender/conectar em 45s, encerra sozinho
      // (evita ficar preso em "Conectando…"/"Chamando…" pra sempre).
      timeoutRef.current = setTimeout(() => {
        if (endedRef.current) return;
        setError("A ligação não completou (sem resposta em 45s).");
        setStatus("failed");
        void markFail(callRowIdRef.current, "timeout");
        cleanup();
      }, 45000);

      client.connect();
    },
    [cleanup],
  );

  const hangup = useCallback(async () => {
    const id = callRowIdRef.current;
    const dur = answeredAtRef.current
      ? Math.round((Date.now() - answeredAtRef.current) / 1000)
      : 0;
    setStatus((s) => (s === "in_progress" || s === "ringing" ? "ended" : s));
    try {
      callRef.current?.hangup?.();
    } catch {
      /* noop */
    }
    // Registro do encerramento no CRM (a notificação de hangup pode chegar
    // depois do teardown, então garantimos o report aqui também — dedup pelo
    // reportedRef).
    finishReport(reportedRef, id, dur);
    cleanup();
  }, [cleanup]);

  return { status, error, seconds, startCall, hangup, remoteAudioRef };
}

/** Reporta uma transição de estado da chamada pro CRM (status + duração). */
async function reportUpdate(
  callId: string | null,
  status: string,
  durationSeconds?: number,
) {
  if (!callId) return;
  try {
    await fetch("/api/telnyx/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", callId, status, durationSeconds }),
    });
  } catch {
    /* best-effort */
  }
}

/** Registra o encerramento UMA vez (dedup por ref), com a duração falada. */
function finishReport(
  reportedRef: { current: boolean },
  callId: string | null,
  durationSeconds: number,
) {
  if (reportedRef.current || !callId) return;
  reportedRef.current = true;
  void reportUpdate(
    callId,
    durationSeconds > 0 ? "completed" : "no_answer",
    durationSeconds,
  );
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
