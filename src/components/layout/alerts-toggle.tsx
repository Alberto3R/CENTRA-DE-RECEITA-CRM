"use client";

import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

import { useAlertsPreference } from "@/hooks/use-unread-alerts";
import { cn } from "@/lib/utils";

/**
 * Liga/desliga o aviso de mensagem nova (som + notificação do sistema).
 *
 * O contador no título da aba não passa por aqui — esse é sempre ligado,
 * porque não interrompe ninguém. O que este botão controla é o que faz
 * barulho, e é também o gesto do usuário que o navegador exige para
 * pedir permissão de notificação.
 *
 * 40×40 para casar com os outros controles do cabeçalho.
 */
export function AlertsToggle({ className }: { className?: string }) {
  const { enabled, permission, toggle } = useAlertsPreference();

  const handleClick = async () => {
    const next = await toggle();
    if (!next) {
      toast.success("Avisos de mensagem nova desligados");
      return;
    }
    if (permission === "denied") {
      toast.success("Aviso sonoro ligado", {
        description:
          "As notificações do sistema estão bloqueadas para este site — libere nas permissões do navegador para receber o aviso com a aba fechada.",
      });
      return;
    }
    toast.success("Avisos de mensagem nova ligados");
  };

  const label = enabled
    ? "Desligar avisos de mensagem nova"
    : "Ligar avisos de mensagem nova";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {enabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
    </button>
  );
}
