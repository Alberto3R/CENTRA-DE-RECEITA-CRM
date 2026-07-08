"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Ouvinte GLOBAL de chamadas WhatsApp entrantes (USER_INITIATED).
 *
 * Assina os INSERTs de `whatsapp_calls` da conta via Realtime. Quando o
 * webhook grava uma chamada entrante (com o SDP offer), abrimos o modal de
 * "chamada recebida". Ao aceitar: geramos o answer no navegador e POST
 * action=accept. Há ~30-60s para atender antes do Meta encerrar.
 */

export type IncomingStatus =
  | "ringing"
  | "answering"
  | "in_progress"
  | "ended"
  | "failed";

interface Incoming {
  id: string;
  phone: string | null;
}

interface CallRow {
  id: string;
  direction: string;
  status: string;
  to_phone: string | null;
  offer_sdp: string | null;
}

function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
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

export function useIncomingWaCall() {
  const { accountId } = useAuth();
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [status, setStatus] = useState<IncomingStatus>("ringing");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (status !== "in_progress") {
      if (status !== "answering") setSeconds(0);
      return;
    }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const offerRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  function supabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const cleanupMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  // Assinatura Realtime persistente enquanto o componente estiver montado.
  useEffect(() => {
    if (!accountId) return;
    const ch = supabase()
      .channel(`wa_calls_in_${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_calls",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new as CallRow;
          if (payload.eventType === "INSERT") {
            if (
              row.direction === "USER_INITIATED" &&
              row.status === "ringing" &&
              row.offer_sdp
            ) {
              offerRef.current = row.offer_sdp;
              setIncoming({ id: row.id, phone: row.to_phone });
              setStatus("ringing");
              setError(null);
            }
          } else if (payload.eventType === "UPDATE") {
            setIncoming((cur) => {
              if (
                cur &&
                row.id === cur.id &&
                ["completed", "failed", "rejected", "missed"].includes(
                  row.status,
                )
              ) {
                cleanupMedia();
                setStatus(row.status === "completed" ? "ended" : "failed");
                return null;
              }
              return cur;
            });
          }
        },
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      ch.unsubscribe();
      channelRef.current = null;
    };
  }, [accountId, cleanupMedia]);

  const accept = useCallback(async () => {
    if (!incoming || !offerRef.current) return;
    setError(null);
    setStatus("answering");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Não foi possível acessar o microfone.");
      setStatus("failed");
      return;
    }
    localStreamRef.current = stream;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.ontrack = (e) => {
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0];
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp: offerRef.current });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceGathering(pc);
    } catch {
      setError("Falha ao preparar a resposta de mídia.");
      setStatus("failed");
      cleanupMedia();
      return;
    }
    const sdp = pc.localDescription?.sdp;
    if (!sdp) {
      setStatus("failed");
      cleanupMedia();
      return;
    }

    try {
      const res = await fetch("/api/whatsapp/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", callId: incoming.id, sdp }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Falha ao aceitar a chamada.");
        setStatus("failed");
        cleanupMedia();
        return;
      }
    } catch {
      setError("Falha de rede ao aceitar.");
      setStatus("failed");
      cleanupMedia();
      return;
    }
    setStatus("in_progress");
  }, [incoming, cleanupMedia]);

  const dismiss = useCallback(
    async (action: "reject" | "terminate") => {
      const cur = incoming;
      setIncoming(null);
      setStatus("ended");
      cleanupMedia();
      if (cur) {
        try {
          await fetch("/api/whatsapp/call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, callId: cur.id }),
          });
        } catch {
          /* best-effort */
        }
      }
    },
    [incoming, cleanupMedia],
  );

  const reject = useCallback(() => dismiss("reject"), [dismiss]);
  const hangup = useCallback(() => dismiss("terminate"), [dismiss]);

  return {
    incoming,
    status,
    error,
    seconds,
    accept,
    reject,
    hangup,
    remoteAudioRef,
  };
}
