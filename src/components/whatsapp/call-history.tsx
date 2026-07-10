"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Sparkles,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

interface CallRow {
  id: string;
  direction: string;
  status: string;
  duration_seconds: number | null;
  created_at: string;
  recording_path: string | null;
  transcript: string | null;
}

function fmtDur(s: number | null): string {
  if (!s) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
const STATUS_LABEL: Record<string, string> = {
  completed: "Atendida",
  failed: "Falhou",
  rejected: "Recusada",
  missed: "Não atendida",
  in_progress: "Em andamento",
  ringing: "Chamando",
  initiating: "Iniciando",
  connecting: "Conectando",
};

/**
 * Histórico de ligações WhatsApp de um contato, com player da gravação e
 * (admin) "Analisar no Gestor" → transcreve (Whisper) + roda a análise de
 * call do Gestor Comercial.
 */
export function CallHistory({ contactId }: { contactId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const { canEditSettings } = useAuth();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("whatsapp_calls")
      .select(
        "id,direction,status,duration_seconds,created_at,recording_path,transcript",
      )
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(6);
    setCalls((data as CallRow[] | null) ?? []);
    setLoading(false);
  }, [supabase, contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function ouvir(id: string) {
    if (urls[id]) return;
    setBusy(`play:${id}`);
    try {
      const res = await fetch(`/api/whatsapp/call/${id}/recording`);
      const j = await res.json();
      if (!res.ok || !j.url) throw new Error(j.error || "sem link");
      setUrls((u) => ({ ...u, [id]: j.url }));
    } catch {
      toast.error("Não foi possível carregar a gravação.");
    } finally {
      setBusy(null);
    }
  }

  async function analisar(id: string) {
    setBusy(`ai:${id}`);
    try {
      // 1) transcreve (idempotente)
      const tr = await fetch(`/api/whatsapp/call/${id}/transcribe`, {
        method: "POST",
      });
      const tj = await tr.json();
      if (!tr.ok || !tj.transcript) {
        throw new Error(tj.error || "Falha na transcrição");
      }
      // 2) roda a análise de call do Gestor
      const an = await fetch("/api/ai/analise-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: tj.transcript,
          origem: "Ligação WhatsApp",
          callId: id,
        }),
      });
      if (!an.ok) {
        const j = await an.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao analisar");
      }
      toast.success("Análise pronta no Gestor Comercial.");
      router.push("/ia/analise");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Carregando ligações…
      </div>
    );
  }
  if (calls.length === 0) {
    return (
      <p className="py-1 text-xs text-muted-foreground">
        Nenhuma ligação registrada.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {calls.map((c) => {
        const Icon =
          c.status === "missed" || c.status === "rejected"
            ? PhoneMissed
            : c.direction === "USER_INITIATED"
              ? PhoneIncoming
              : PhoneOutgoing;
        return (
          <li
            key={c.id}
            className="rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-foreground">
                {STATUS_LABEL[c.status] ?? c.status}
                {c.duration_seconds ? ` · ${fmtDur(c.duration_seconds)}` : ""}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {fmtDate(c.created_at)}
              </span>
            </div>

            {c.recording_path && (
              <div className="mt-1.5">
                {urls[c.id] ? (
                  <audio
                    controls
                    src={urls[c.id]}
                    className="h-8 w-full"
                    autoPlay
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={busy === `play:${c.id}`}
                      onClick={() => ouvir(c.id)}
                    >
                      {busy === `play:${c.id}` ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      Ouvir
                    </Button>
                    {canEditSettings && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
                        disabled={busy === `ai:${c.id}`}
                        onClick={() => analisar(c.id)}
                        title="Transcrever e analisar no Gestor Comercial"
                      >
                        {busy === `ai:${c.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        Analisar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
