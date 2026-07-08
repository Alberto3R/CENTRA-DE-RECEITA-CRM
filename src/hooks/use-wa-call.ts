"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  startCallRecording,
  type CallRecorder,
} from "@/lib/whatsapp/call-recorder";

/**
 * Softphone WhatsApp (business-initiated) — WebRTC no navegador.
 *
 * Fluxo:
 *   1) getUserMedia(audio) → RTCPeerConnection → createOffer
 *   2) espera o ICE gathering terminar (a Calling API usa SDP completo,
 *      não-trickle) e manda o offer pro /api/whatsapp/call
 *   3) assina Realtime na linha whatsapp_calls: quando o webhook grava o
 *      answer_sdp, aplicamos como remoteDescription e o áudio conecta
 *   4) status (ringing/in_progress/ended) vem pelos UPDATEs da mesma linha
 *
 * O áudio é ponta-a-ponta navegador<->WhatsApp; nada de mídia passa pelo
 * backend. Renderize um <audio ref={remoteAudioRef} autoPlay /> no consumidor.
 */

export type CallStatus =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "ringing"
  | "in_progress"
  | "ended"
  | "failed"
  | "needs_permission";

interface StartOpts {
  contactId?: string;
  dealId?: string;
  to?: string;
}

interface CallRow {
  id: string;
  status: string;
  answer_sdp: string | null;
}

function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    // fallback: não trava para sempre se algum candidato demorar
    const timer = setTimeout(resolve, 4000);
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export function useWaCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [permissionSent, setPermissionSent] = useState(false);
  // Duração da chamada (segundos) — começa a contar quando o lead atende
  // (status 'in_progress'). Usado pelo botão pra mostrar 0:12 etc.
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callRowIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function supabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  // ---- Gravação da chamada (WebRTC → Storage) ----
  const { accountId } = useAuth();
  const accountIdRef = useRef<string | null>(accountId ?? null);
  accountIdRef.current = accountId ?? null;
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<CallRecorder | null>(null);
  const recordingArmedRef = useRef(false);

  const uploadRecording = useCallback(async (rowId: string, blob: Blob) => {
    const acc = accountIdRef.current;
    if (!acc) return;
    try {
      const path = `${acc}/${rowId}.webm`;
      const sb = supabase();
      const { error } = await sb.storage
        .from("call-recordings")
        .upload(path, blob, {
          contentType: blob.type || "audio/webm",
          upsert: true,
        });
      if (error) {
        console.error("[wa-call] upload da gravação falhou:", error.message);
        return;
      }
      await sb
        .from("whatsapp_calls")
        .update({ recording_path: path })
        .eq("id", rowId);
    } catch (e) {
      console.error("[wa-call] finalização da gravação falhou:", e);
    }
    // supabase() é estável (ref) — nada de dep externa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Só grava quando a chamada foi ATENDIDA (armada em in_progress) e já há os
  // dois streams (mic + lead).
  const maybeStartRecording = useCallback(() => {
    if (recorderRef.current || !recordingArmedRef.current) return;
    if (localStreamRef.current && remoteStreamRef.current) {
      recorderRef.current = startCallRecording(
        localStreamRef.current,
        remoteStreamRef.current,
      );
    }
  }, []);

  const cleanup = useCallback(() => {
    // finaliza a gravação (best-effort) ANTES de derrubar as tracks
    recordingArmedRef.current = false;
    const rec = recorderRef.current;
    recorderRef.current = null;
    const recRowId = callRowIdRef.current;
    if (rec) {
      void rec.stop().then((blob) => {
        if (blob && recRowId) void uploadRecording(recRowId, blob);
      });
    }
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    callRowIdRef.current = null;
  }, [uploadRecording]);

  const startCall = useCallback(
    async (opts: StartOpts) => {
      setError(null);
      cleanup();

      // 1) microfone
      setStatus("requesting_mic");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Não foi possível acessar o microfone.");
        setStatus("failed");
        return;
      }
      localStreamRef.current = stream;

      // 2) peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0] ?? null;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0];
        maybeStartRecording();
      };
      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          setStatus((s) => (s === "ended" ? s : "failed"));
        }
      };

      // 3) offer + ICE completo (não-trickle)
      setStatus("connecting");
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      await waitIceGathering(pc);
      const sdp = pc.localDescription?.sdp;
      if (!sdp) {
        setError("Falha ao gerar a oferta de mídia.");
        setStatus("failed");
        cleanup();
        return;
      }

      // 4) dispara via backend
      let data: { id?: string; error?: string; needsPermission?: boolean };
      try {
        const res = await fetch("/api/whatsapp/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "initiate", ...opts, sdp }),
        });
        data = await res.json();
        if (!res.ok || !data.id) {
          setError(data.error ?? "Falha ao iniciar a chamada.");
          setStatus(data.needsPermission ? "needs_permission" : "failed");
          cleanup();
          return;
        }
      } catch {
        setError("Falha de rede ao iniciar a chamada.");
        setStatus("failed");
        cleanup();
        return;
      }
      callRowIdRef.current = data.id;
      setStatus("ringing");

      // 5) sinalização via Realtime na linha da chamada
      const ch = supabase()
        .channel(`wa_call_${data.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "whatsapp_calls",
            filter: `id=eq.${data.id}`,
          },
          async (payload) => {
            const row = payload.new as CallRow;
            if (
              row.answer_sdp &&
              pcRef.current &&
              pcRef.current.signalingState === "have-local-offer"
            ) {
              try {
                await pcRef.current.setRemoteDescription({
                  type: "answer",
                  sdp: row.answer_sdp,
                });
              } catch (e) {
                console.error("[wa-call] setRemoteDescription falhou", e);
              }
            }
            if (row.status === "in_progress") {
              setStatus("in_progress");
              recordingArmedRef.current = true;
              maybeStartRecording();
            } else if (row.status === "ringing") setStatus("ringing");
            else if (
              ["completed", "failed", "rejected", "missed"].includes(row.status)
            ) {
              setStatus(row.status === "completed" ? "ended" : "failed");
              cleanup();
            }
          },
        )
        .subscribe();
      channelRef.current = ch;
    },
    [cleanup, maybeStartRecording],
  );

  const requestPermission = useCallback(async (opts: StartOpts) => {
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_permission", ...opts }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Falha ao pedir permissão.");
        return false;
      }
      setPermissionSent(true);
      setStatus("idle");
      return true;
    } catch {
      setError("Falha de rede ao pedir permissão.");
      return false;
    }
  }, []);

  const hangup = useCallback(async () => {
    const id = callRowIdRef.current;
    setStatus("ended");
    if (id) {
      try {
        await fetch("/api/whatsapp/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "terminate", callId: id }),
        });
      } catch {
        /* best-effort */
      }
    }
    cleanup();
  }, [cleanup]);

  return {
    status,
    error,
    permissionSent,
    seconds,
    startCall,
    hangup,
    requestPermission,
    remoteAudioRef,
  };
}
