"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles,
  Webhook,
  ArrowRightLeft,
  UserCog,
  CircleCheck,
  CircleX,
  RotateCcw,
  DollarSign,
  Loader2,
  History,
} from "lucide-react";

// Histórico vivo do negócio — timeline que se autoalimenta dos eventos
// gravados pelo trigger `log_deal_event` (migration 081) + enriquecimento
// dos webhooks de captação (origem/UTM/payload). Só leitura.
interface DealEvent {
  id: string;
  type: string;
  actor_user_id: string | null;
  from_id: string | null;
  to_id: string | null;
  from_value: string | null;
  to_value: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface ProfileLite {
  id: string;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} d`;
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function statusLabel(v: string | null): string {
  if (v === "won") return "Ganho";
  if (v === "lost") return "Perdido";
  if (v === "open") return "Aberto";
  return v || "—";
}

const ICONS: Record<string, typeof Sparkles> = {
  created: Sparkles,
  created_via_integration: Webhook,
  stage_changed: ArrowRightLeft,
  assignee_changed: UserCog,
  status_changed: CircleCheck,
  value_changed: DollarSign,
  note_added: History,
};

export function DealHistory({ dealId }: { dealId: string }) {
  const supabase = createClient();
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [nameByUser, setNameByUser] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [ev, pr] = await Promise.all([
        supabase
          .from("deal_events")
          .select("*")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, user_id, full_name, email"),
      ]);
      if (cancelled) return;
      const profiles = (pr.data ?? []) as ProfileLite[];
      const byId = new Map<string, string>();
      const byUser = new Map<string, string>();
      for (const p of profiles) {
        const label = p.full_name || p.email || "Usuário";
        byId.set(p.id, label);
        if (p.user_id) byUser.set(p.user_id, label);
      }
      setNameById(byId);
      setNameByUser(byUser);
      setEvents((ev.data ?? []) as DealEvent[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId, supabase]);

  function actorLabel(e: DealEvent): string {
    if (e.actor_user_id) return nameByUser.get(e.actor_user_id) || "Usuário";
    return "ação automática do sistema";
  }

  function describe(e: DealEvent): { title: string; body?: React.ReactNode } {
    switch (e.type) {
      case "created":
        return { title: "Negócio criado" };
      case "created_via_integration": {
        const m = e.metadata ?? {};
        const integ = (m.integration as string) || "integração";
        const origem = (m.origem as string) || null;
        return {
          title: `Negócio criado via ${integ}`,
          body: (
            <div className="mt-1.5 space-y-1.5">
              {origem && (
                <p className="text-xs text-muted-foreground">
                  Origem: <span className="text-foreground">{origem}</span>
                </p>
              )}
              {Boolean(m.utm_source || m.utm_campaign) && (
                <p className="text-xs text-muted-foreground">
                  UTM: <span className="text-foreground">{String(m.utm_source ?? "—")}</span>
                  {" · "}
                  {String(m.utm_campaign ?? "—")}
                </p>
              )}
              {typeof m.landing_url === "string" && (
                <p className="truncate text-xs text-muted-foreground">
                  Página: <span className="text-foreground">{m.landing_url}</span>
                </p>
              )}
              {m.payload != null && (
                <details className="group">
                  <summary className="cursor-pointer list-none text-xs font-medium text-primary hover:underline">
                    Mostrar dados
                  </summary>
                  <pre className="mt-1.5 max-h-56 overflow-auto rounded-md border border-border bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(m.payload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ),
        };
      }
      case "stage_changed":
        return {
          title: `Mudou de etapa: ${e.from_value || "—"} → ${e.to_value || "—"}`,
        };
      case "assignee_changed": {
        const from = e.from_id ? nameById.get(e.from_id) || "alguém" : "sem responsável";
        const to = e.to_id ? nameById.get(e.to_id) || "alguém" : "sem responsável";
        return { title: `Responsável: ${from} → ${to}` };
      }
      case "status_changed":
        return {
          title: `Status: ${statusLabel(e.from_value)} → ${statusLabel(e.to_value)}`,
        };
      case "value_changed":
        return {
          title: `Valor alterado: ${e.from_value ?? "0"} → ${e.to_value ?? "0"}`,
        };
      default:
        return { title: e.type };
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
        <History className="h-6 w-6" />
        <p className="text-sm">Sem histórico ainda.</p>
        <p className="text-xs">As ações no negócio aparecem aqui automaticamente.</p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-1 pl-1">
      {events.map((e, i) => {
        const Icon = ICONS[e.type] || History;
        const { title, body } = describe(e);
        const isStatusLost = e.type === "status_changed" && e.to_value === "lost";
        const StatusIcon = isStatusLost ? CircleX : e.to_value === "open" ? RotateCcw : Icon;
        const FinalIcon = e.type === "status_changed" ? StatusIcon : Icon;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4">
            {/* linha vertical conectando os eventos */}
            {i < events.length - 1 && (
              <span className="absolute left-[15px] top-8 h-full w-px bg-border" aria-hidden />
            )}
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                isStatusLost
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : "border-primary/30 bg-primary/10 text-primary"
              }`}
            >
              <FinalIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm text-foreground">{title}</p>
              {body}
              <p
                className="mt-0.5 text-xs text-muted-foreground"
                title={new Date(e.created_at).toLocaleString("pt-BR")}
              >
                {relativeTime(e.created_at)} · por {actorLabel(e)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
