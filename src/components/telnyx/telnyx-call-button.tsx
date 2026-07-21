"use client";

import { Loader2, PhoneCall, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTelnyxCall, type TelnyxCallStatus } from "@/hooks/use-telnyx-call";

/**
 * Botão de ligação PSTN (Telnyx) — liga DIRETO pro telefone do lead pelo
 * softphone WebRTC no navegador. Autocontido: usa useTelnyxCall, mostra o
 * estado e embute o <audio> remoto. `compact` = só ícone (header/sidebar).
 *
 * Diferente do WhatsApp (WaCallButton): não precisa de permissão do lead — é
 * telefonia comum, com nosso número de Goiânia como caller id.
 */
const LABEL: Record<TelnyxCallStatus, string> = {
  idle: "Ligar (telefone)",
  connecting: "Conectando…",
  ringing: "Chamando…",
  in_progress: "Em chamada",
  ended: "Ligar (telefone)",
  failed: "Ligar (telefone)",
};

export function TelnyxCallButton({
  contactId,
  dealId,
  to,
  compact = false,
  className,
}: {
  contactId?: string;
  dealId?: string;
  to?: string;
  compact?: boolean;
  className?: string;
}) {
  const { status, error, seconds, startCall, hangup, remoteAudioRef } =
    useTelnyxCall();
  const opts = { contactId, dealId, to };
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const activeLabel =
    status === "in_progress"
      ? mmss
      : status === "ringing"
        ? "Chamando…"
        : "Conectando…";

  const active =
    status === "connecting" ||
    status === "ringing" ||
    status === "in_progress";
  const busy = status === "connecting";

  const title =
    status === "failed" && error ? error : "Ligar direto pro telefone (Telnyx)";

  const audio = <audio ref={remoteAudioRef} autoPlay className="hidden" />;

  if (compact) {
    if (active) {
      return (
        <>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 py-0.5 pl-2 pr-0.5">
            <span className="flex h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-xs tabular-nums text-red-300">
              {activeLabel}
            </span>
            {status === "in_progress" && (
              <span
                title="Chamada sendo gravada"
                className="text-[9px] font-semibold uppercase tracking-wide text-red-400/80"
              >
                REC
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={hangup}
              title="Encerrar chamada"
              aria-label="Encerrar chamada"
              className="h-6 w-6 text-red-300 hover:bg-red-500/20 hover:text-red-200"
            >
              <PhoneOff className="h-3.5 w-3.5" />
            </Button>
          </div>
          {audio}
        </>
      );
    }
    return (
      <>
        <Button
          variant="ghost"
          size="icon-sm"
          title={title}
          aria-label={title}
          onClick={() => startCall(opts)}
          className={
            status === "failed"
              ? "text-amber-400 hover:text-amber-300"
              : "text-muted-foreground hover:text-primary"
          }
        >
          <PhoneCall className="h-4 w-4" />
        </Button>
        {audio}
      </>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {active ? (
          <Button
            variant="outline"
            onClick={hangup}
            className="border-red-500/40 text-red-400 hover:bg-red-500/10"
          >
            <PhoneOff className="size-4" />
            Encerrar
          </Button>
        ) : (
          <Button
            onClick={() => startCall(opts)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PhoneCall className="size-4" />
            )}
            {LABEL[status]}
          </Button>
        )}
        {active && (
          <span className="text-xs text-muted-foreground">{activeLabel}</span>
        )}
      </div>

      {status === "failed" && error && (
        <p className="mt-1.5 text-xs text-red-400">{error}</p>
      )}

      {audio}
    </div>
  );
}
