"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

/**
 * Barra permanente enquanto uma sessão de impersonation está ativa.
 *
 * Não é decoração e não é dispensável: o risco real da impersonation é
 * o operador esquecer que está dentro da conta de um cliente e agir
 * achando que é a sua. A barra ocupa espaço no layout (não sobrepõe),
 * usa cor de alerta e não tem botão de fechar.
 *
 * O contador não é enfeite também — a sessão expira sozinha no banco,
 * e ver o tempo restante evita a confusão de "a tela parou de carregar
 * dados" quando na verdade o prazo acabou.
 */

interface ImpersonationBannerProps {
  accountName: string;
  reason: string;
  /** ISO — vem do banco, é ele quem manda no prazo. */
  expiresAt: string;
}

function remainingLabel(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "expirada";
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ImpersonationBanner({
  accountName,
  reason,
  expiresAt,
}: ImpersonationBannerProps) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expired = new Date(expiresAt).getTime() - now <= 0;

  // Ao expirar, o banco para de conceder leitura e a tela ficaria vazia
  // sem explicação. Um refresh devolve o usuário à própria conta, que é
  // o estado correto.
  useEffect(() => {
    if (expired) router.refresh();
  }, [expired, router]);

  async function handleLeave() {
    try {
      setLeaving(true);
      const res = await fetch("/api/admin/impersonate", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Não foi possível encerrar a sessão.");
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      toast.error("Não foi possível encerrar a sessão.");
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-amber-500 px-4 py-2 text-amber-950"
    >
      <Eye className="size-4 shrink-0" aria-hidden="true" />

      <span className="text-sm font-semibold">
        Você está vendo a conta {accountName}
      </span>

      <span className="rounded-full bg-amber-950/15 px-2 py-0.5 text-[11px] font-medium">
        somente leitura
      </span>

      <span className="min-w-0 flex-1 truncate text-xs opacity-80">
        {reason}
      </span>

      <span className="shrink-0 text-xs font-medium tabular-nums">
        {expired ? "sessão expirada" : `expira em ${remainingLabel(expiresAt, now)}`}
      </span>

      <button
        type="button"
        onClick={handleLeave}
        disabled={leaving}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-950/15 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-amber-950/25 disabled:opacity-60"
      >
        {leaving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <LogOut className="size-3.5" />
        )}
        Sair da conta
      </button>
    </div>
  );
}
