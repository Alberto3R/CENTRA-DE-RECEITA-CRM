"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Diagnóstico e ativação do canal de WhatsApp de um tenant.
 *
 * Existe porque a impersonation é somente-leitura, e o problema de
 * suporte mais comum ("o cliente registrou o número e ele não conectou")
 * exige escrever. Em vez de abrir escrita geral na conta do cliente,
 * esta tela faz UMA operação, com log — o raio de alcance é o canal.
 *
 * Na maioria das vezes nem PIN é preciso: quando a Meta já reporta
 * CONNECTED, o que está errado é só o estado local, e o diagnóstico
 * reconcilia sozinho.
 */

interface Channel {
  id: string;
  label: string | null;
  isPrimary: boolean;
  channelType: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  status: string | null;
  registeredAt: string | null;
  lastRegistrationError: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
  hasSavedPin: boolean;
}

const MIN_REASON_LENGTH = 10;

export function ChannelDialog({
  accountId,
  accountName,
  open,
  onOpenChange,
  onChanged,
}: {
  accountId: string | null;
  accountName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tenants/${accountId}/channels`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Não foi possível carregar os canais.");
        setChannels([]);
        return;
      }
      setChannels(data.channels ?? []);
    } catch {
      toast.error("Não foi possível carregar os canais.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (open) {
      setPin("");
      setReason("");
      void load();
    }
  }, [open, load]);

  async function activate(channelId: string) {
    if (reason.trim().length < MIN_REASON_LENGTH) {
      toast.error(
        `Descreva o motivo com pelo menos ${MIN_REASON_LENGTH} caracteres.`,
      );
      return;
    }
    try {
      setBusyId(channelId);
      const res = await fetch(
        `/api/admin/tenants/${accountId}/activate-whatsapp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId,
            pin: pin.trim() || undefined,
            reason: reason.trim(),
          }),
        },
      );
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Falha ao ativar.", { duration: 12000 });
        return;
      }

      const outcome = data.activation?.outcome as string | undefined;
      if (outcome === "already_connected") {
        toast.success(
          "A Meta já reportava o número como conectado — o estado local estava desatualizado e foi corrigido.",
          { duration: 10000 },
        );
      } else if (outcome === "registered") {
        toast.success("Número ativado. O cliente já pode enviar e receber.");
      } else if (outcome === "needs_pin") {
        toast.warning(
          "Falta o PIN de verificação em duas etapas. Peça ao cliente e informe no campo acima.",
          { duration: 12000 },
        );
      } else if (outcome === "needs_old_pin") {
        toast.error(
          "A Meta recusou o PIN. Se o número já teve 2SV, só o PIN ANTIGO funciona — o reset leva 7 dias.",
          { duration: 14000 },
        );
      } else if (outcome === "needs_code_verification") {
        toast.warning(
          "A verificação do número expirou. Só o cliente resolve: a Meta manda um código por SMS ou ligação para a linha dele.",
          { duration: 14000 },
        );
      } else {
        toast.error(data.activation?.message ?? "Não foi possível ativar.", {
          duration: 12000,
        });
      }

      setPin("");
      await load();
      onChanged();
    } catch {
      toast.error("Não foi possível ativar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Canais de {accountName}</DialogTitle>
          <DialogDescription>
            Diagnostica o número na Meta e ativa se possível. Diferente de
            entrar na conta, esta ação escreve — e só no canal.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : channels.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Este tenant não tem canal de WhatsApp configurado.
          </p>
        ) : (
          <div className="space-y-3">
            {channels.map((c) => {
              const connected = c.status === "connected" && c.registeredAt;
              const expired = c.codeVerificationStatus === "EXPIRED";
              return (
                <div
                  key={c.id}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {connected ? (
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                        ) : expired ? (
                          <XCircle className="size-4 shrink-0 text-red-500" />
                        ) : (
                          <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                        )}
                        <span className="truncate text-sm font-medium text-foreground">
                          {c.label ?? "Canal"}
                          {c.isPrimary && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              principal
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {c.phoneNumberId ?? "sem phone_number_id"}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId !== null}
                      onClick={() => void activate(c.id)}
                    >
                      {busyId === c.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Diagnosticar e ativar
                    </Button>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>status local:</dt>
                      <dd className="text-foreground">{c.status ?? "—"}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>verificação:</dt>
                      <dd className={expired ? "text-red-400" : "text-foreground"}>
                        {c.codeVerificationStatus ?? "desconhecida"}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>plataforma:</dt>
                      <dd className="text-foreground">{c.platformType ?? "—"}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>PIN salvo:</dt>
                      <dd className="text-foreground">
                        {c.hasSavedPin ? "sim" : "não"}
                      </dd>
                    </div>
                  </dl>

                  {c.lastRegistrationError && (
                    <p className="mt-2 rounded bg-destructive/10 px-2 py-1 text-[11px] text-red-300">
                      {c.lastRegistrationError}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-3 border-t border-border pt-3">
          <div className="space-y-1.5">
            <Label htmlFor="admin-reason" className="text-muted-foreground">
              Motivo
            </Label>
            <Input
              id="admin-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ex.: chamado #482 — número registrado mas sem conectar"
              className="border-border bg-muted text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-pin" className="text-muted-foreground">
              PIN de duas etapas{" "}
              <span className="text-muted-foreground">(se necessário)</span>
            </Label>
            <Input
              id="admin-pin"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6 dígitos"
              className="border-border bg-muted text-sm tracking-widest"
            />
            <p className="text-[11px] text-muted-foreground">
              Deixe em branco primeiro. Muitos casos são só estado local
              desatualizado e resolvem sem PIN. Se a Meta pedir, o número já
              teve 2SV e só o <strong>PIN antigo</strong> funciona — peça ao
              cliente.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
