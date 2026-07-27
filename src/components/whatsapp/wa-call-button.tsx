"use client";

import { Loader2, Phone, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWaCall, type CallStatus } from "@/hooks/use-wa-call";

/**
 * Botão de ligação WhatsApp (business-initiated). Unidade autocontida:
 * chama o hook useWaCall, mostra o estado e embute o <audio> remoto.
 * `compact` = só ícone (para o header da conversa); padrão = botão com texto.
 *
 * NB: só liga de fato quando (1) calling habilitado, (2) app inscrito no
 * webhook "calls", (3) o lead concedeu permissão e (4) tier >= 2.000/dia.
 * Sem permissão, o backend retorna needsPermission e a UI avisa.
 */
const LABEL: Record<CallStatus, string> = {
  idle: "Ligar",
  requesting_mic: "Liberando microfone…",
  connecting: "Conectando…",
  ringing: "Chamando…",
  in_progress: "Em chamada",
  ended: "Ligar",
  failed: "Ligar",
  needs_permission: "Ligar",
};

export function WaCallButton({
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
  const {
    status,
    error,
    permissionSent,
    seconds,
    startCall,
    hangup,
    requestPermission,
    remoteAudioRef,
  } = useWaCall();
  const opts = { contactId, dealId, to };
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const activeLabel =
    status === "in_progress"
      ? mmss
      : status === "ringing"
        ? "Chamando…"
        : status === "requesting_mic"
          ? "Microfone…"
          : "Conectando…";

  const active =
    status === "requesting_mic" ||
    status === "connecting" ||
    status === "ringing" ||
    status === "in_progress";
  const busy = status === "requesting_mic" || status === "connecting";

  const title =
    status === "needs_permission"
      ? "O lead ainda não autorizou chamadas — envie um pedido de permissão."
      : status === "failed" && error
        ? error
        : active
          ? LABEL[status]
          : "Ligar pelo WhatsApp";

  const audio = <audio ref={remoteAudioRef} autoPlay className="hidden" />;

  if (compact) {
    // Em chamada: "pílula" clara com bolinha vermelha + estado/contador +
    // encerrar. Fora de chamada: só o ícone de telefone. Sem sobreposição.
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
          onClick={() =>
            status === "needs_permission"
              ? requestPermission(opts)
              : startCall(opts)
          }
          className={
            status === "needs_permission" || status === "failed"
              ? "text-amber-400 hover:text-amber-300"
              : "text-blue-500 hover:text-blue-400"
          }
        >
          <Phone className="h-4 w-4" />
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
        ) : status === "needs_permission" ? (
          <Button
            variant="outline"
            onClick={() => requestPermission(opts)}
            className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
          >
            <Phone className="size-4" />
            Pedir permissão
          </Button>
        ) : (
          <Button
            onClick={() => startCall(opts)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Phone className="size-4" />
            )}
            {LABEL[status]}
          </Button>
        )}
        {active && (
          <span className="text-xs text-muted-foreground">{LABEL[status]}</span>
        )}
      </div>

      {permissionSent && (
        <p className="mt-1.5 text-xs text-primary">
          Pedido de permissão enviado. Quando o lead aceitar, é só ligar.
        </p>
      )}
      {status === "needs_permission" && !permissionSent && (
        <p className="mt-1.5 text-xs text-amber-400">
          O lead ainda não autorizou chamadas. Toque em “Pedir permissão”.
        </p>
      )}
      {status === "failed" && error && (
        <p className="mt-1.5 text-xs text-red-400">{error}</p>
      )}

      {audio}
    </div>
  );
}
