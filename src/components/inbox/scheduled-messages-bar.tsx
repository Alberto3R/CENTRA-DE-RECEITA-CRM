"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { formatScheduleLabel } from "@/lib/inbox/schedule";
import type { ScheduledMessage } from "@/types";
import { Button } from "@/components/ui/button";

interface ScheduledMessagesBarProps {
  conversationId: string;
  /** Bump para recarregar depois de agendar. */
  refreshToken?: number;
}

/**
 * Faixa acima do compositor com os agendamentos pendentes da conversa.
 *
 * Fica sempre visível de propósito: a decisão de produto foi NÃO cancelar
 * automaticamente quando o lead responde antes da data — "te chamo dia 20"
 * continua valendo. Em troca, o vendedor precisa ver o que está engatilhado
 * toda vez que abre a conversa, para cancelar se não fizer mais sentido.
 *
 * Também mostra falhas, porque um agendamento que morreu em silêncio é
 * pior que não ter agendado: o vendedor conta com o toque que nunca saiu.
 */
export function ScheduledMessagesBar({
  conversationId,
  refreshToken = 0,
}: ScheduledMessagesBarProps) {
  const [rows, setRows] = useState<ScheduledMessage[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .in("status", ["pending", "sending", "failed"])
      .order("scheduled_at");
    setRows((data as ScheduledMessage[] | null) ?? []);
  }, [conversationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows();
  }, [fetchRows, refreshToken]);

  const cancel = useCallback(
    async (row: ScheduledMessage) => {
      setBusyId(row.id);
      const supabase = createClient();
      const { error } = await supabase
        .from("scheduled_messages")
        .update({ status: "canceled" })
        .eq("id", row.id);
      setBusyId(null);

      if (error) {
        toast.error("Não foi possível cancelar.");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    },
    [],
  );

  const dismissFailed = useCallback(async (row: ScheduledMessage) => {
    setBusyId(row.id);
    const supabase = createClient();
    await supabase
      .from("scheduled_messages")
      .update({ status: "canceled" })
      .eq("id", row.id);
    setBusyId(null);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-1 border-t border-border bg-card px-3 pt-2">
      {rows.map((row) => {
        const failed = row.status === "failed";
        return (
          <div
            key={row.id}
            className={
              failed
                ? "flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2"
                : "flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2"
            }
          >
            {failed ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
            ) : (
              <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-primary" />
            )}

            <div className="min-w-0 flex-1">
              <p
                className={
                  failed
                    ? "text-xs font-medium text-red-400"
                    : "text-xs font-medium text-primary"
                }
              >
                {failed
                  ? "Falhou o envio agendado"
                  : `Agendada ${formatScheduleLabel(row.scheduled_at)} · ${format(
                      new Date(row.scheduled_at),
                      "dd/MM 'às' HH:mm",
                    )}`}
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {failed ? row.error : row.preview}
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busyId === row.id}
              onClick={() => (failed ? dismissFailed(row) : cancel(row))}
              title={failed ? "Dispensar" : "Cancelar agendamento"}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              {busyId === row.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
