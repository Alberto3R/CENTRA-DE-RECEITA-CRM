"use client";

import { Loader2, Phone, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useIncomingWaCall } from "@/hooks/use-incoming-wa-call";

/**
 * Modal global de chamada WhatsApp recebida. Montado no layout do dashboard
 * (fica sempre escutando via Realtime). Toca? Mostra Atender/Recusar; em
 * chamada, mostra Encerrar. O áudio remoto sai do <audio> embutido.
 */
export function IncomingCallModal() {
  const { incoming, status, error, seconds, accept, reject, hangup, remoteAudioRef } =
    useIncomingWaCall();

  const inCall = status === "in_progress";
  const answering = status === "answering";
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <>
      {incoming && (
        <div className="fixed bottom-4 right-4 z-[60] w-[300px] rounded-xl border border-border bg-card p-4 shadow-2xl animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Phone className={inCall ? "size-5" : "size-5 animate-pulse"} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {incoming.phone ?? "Número desconhecido"}
              </p>
              <p className="text-xs text-muted-foreground">
                {inCall ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="font-mono tabular-nums text-red-300">{mmss}</span>
                    <span>· WhatsApp</span>
                  </span>
                ) : answering ? (
                  "Conectando…"
                ) : (
                  "Chamada recebida · WhatsApp"
                )}
              </p>
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            {inCall || answering ? (
              <Button
                onClick={hangup}
                className="bg-red-500 text-white hover:bg-red-600"
              >
                <PhoneOff className="size-4" />
                Encerrar
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={reject}
                  className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                >
                  <PhoneOff className="size-4" />
                  Recusar
                </Button>
                <Button
                  onClick={accept}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {answering ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Phone className="size-4" />
                  )}
                  Atender
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <audio ref={remoteAudioRef} autoPlay className="hidden" />
    </>
  );
}
