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
import { Card, CardContent } from "@/components/ui/card";

interface CallRow {
  id: string;
  direction: string;
  status: string;
  duration_seconds: number | null;
  created_at: string;
  recording_path: string | null;
  transcript: string | null;
  contact: { name: string | null; phone: string | null } | null;
}

function fmtDur(s: number | null) {
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
const STATUS: Record<string, { label: string; cls: string }> = {
  completed: { label: "Atendida", cls: "text-primary" },
  failed: { label: "Falhou", cls: "text-red-400" },
  rejected: { label: "Recusada", cls: "text-red-400" },
  missed: { label: "Não atendida", cls: "text-amber-400" },
  in_progress: { label: "Em andamento", cls: "text-muted-foreground" },
  ringing: { label: "Chamando", cls: "text-muted-foreground" },
};

export default function LigacoesPage() {
  const supabase = createClient();
  const router = useRouter();
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyRec, setOnlyRec] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Página de gestão — agentes/visualizadores não acessam por URL.
  useEffect(() => {
    if (!profileLoading && !canEditSettings) router.replace("/dashboard");
  }, [profileLoading, canEditSettings, router]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    let q = supabase
      .from("whatsapp_calls")
      .select(
        "id,direction,status,duration_seconds,created_at,recording_path,transcript,contact:contacts(name,phone)",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (onlyRec) q = q.not("recording_path", "is", null);
    const { data } = await q;
    setCalls((data as unknown as CallRow[]) ?? []);
    setLoading(false);
  }, [supabase, accountId, onlyRec]);

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
      const tr = await fetch(`/api/whatsapp/call/${id}/transcribe`, {
        method: "POST",
      });
      const tj = await tr.json();
      if (!tr.ok || !tj.transcript) throw new Error(tj.error || "Falha na transcrição");
      const an = await fetch("/api/ai/analise-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: tj.transcript, origem: "Ligação WhatsApp" }),
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

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Ligações
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Histórico das chamadas WhatsApp — ouça a gravação e analise com o
            Gestor Comercial.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 pt-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyRec}
            onChange={(e) => setOnlyRec(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Só com gravação
        </label>
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </div>
        ) : calls.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma ligação registrada ainda.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {calls.map((c) => {
              const st = STATUS[c.status] ?? {
                label: c.status,
                cls: "text-muted-foreground",
              };
              const Icon =
                c.status === "missed" || c.status === "rejected"
                  ? PhoneMissed
                  : c.direction === "USER_INITIATED"
                    ? PhoneIncoming
                    : PhoneOutgoing;
              return (
                <li key={c.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {c.contact?.name || c.contact?.phone || "Sem contato"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {c.direction === "USER_INITIATED" ? "Recebida" : "Efetuada"} ·{" "}
                          {fmtDate(c.created_at)}
                        </p>
                      </div>
                      <span className={`text-xs font-medium ${st.cls}`}>
                        {st.label}
                      </span>
                      <span className="w-12 text-right font-mono text-xs text-muted-foreground">
                        {fmtDur(c.duration_seconds)}
                      </span>

                      {c.recording_path ? (
                        urls[c.id] ? (
                          <audio
                            controls
                            src={urls[c.id]}
                            autoPlay
                            className="h-8 w-full sm:w-64"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 text-xs"
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
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-xs text-primary hover:text-primary"
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
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground/70">
                          sem gravação
                        </span>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
