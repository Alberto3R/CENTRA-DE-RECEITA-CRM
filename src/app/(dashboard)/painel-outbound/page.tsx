"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Star, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Kpis {
  dials: number;
  atendimentos: number;
  decisor: number;
  reunioes: number;
  qualificados: number;
}
interface Sdr extends Kpis {
  user_id: string;
  name: string;
}
interface Panel {
  metas: Kpis;
  metaReunioesMes: number;
  sdrs: Sdr[];
  team: Kpis;
  forecast: { reunioesMes: number; projecaoMes: number };
}

const KPIS: { key: keyof Kpis; label: string; star?: boolean }[] = [
  { key: "dials", label: "Ligações" },
  { key: "atendimentos", label: "Atendimentos" },
  { key: "decisor", label: "Conversas c/ decisor", star: true },
  { key: "reunioes", label: "Reuniões agendadas" },
  { key: "qualificados", label: "Leads qualificados" },
];

function businessDaysElapsed(now: Date): number {
  const y = now.getFullYear();
  const m = now.getMonth();
  let count = 0;
  for (let d = 1; d <= now.getDate(); d++) {
    const wd = new Date(y, m, d).getDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return Math.max(1, count);
}

// cor semáforo dessaturada (segue o brand: sem semáforo gritante)
function tone(v: number, meta: number): string {
  if (meta <= 0) return "text-foreground";
  const p = v / meta;
  if (p >= 1) return "text-primary";
  if (p >= 0.6) return "text-amber-400";
  return "text-muted-foreground";
}

export default function PainelOutbound() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [tipo, setTipo] = useState("call");
  const [resultado, setResultado] = useState("no_answer");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const params = new URLSearchParams({
      from: new Date(y, m, d, 0, 0, 0).toISOString(),
      to: new Date(y, m, d, 23, 59, 59).toISOString(),
      monthFrom: new Date(y, m, 1, 0, 0, 0).toISOString(),
      diasUteis: String(businessDaysElapsed(now)),
    });
    try {
      const res = await fetch(`/api/outbound/panel?${params}`);
      const data = await res.json();
      if (res.ok) setPanel(data as Panel);
    } catch {
      /* silencioso — mantém o painel anterior */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function registrar() {
    setSaving(true);
    try {
      const res = await fetch("/api/outbound/panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          resultado: tipo === "call" ? resultado : undefined,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Atividade registrada");
      setModal(false);
      setNotes("");
      await load();
    } catch {
      toast.error("Não foi possível registrar a atividade");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Painel Outbound
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A atividade do dia do time de prospecção — combustível vs meta, e a
            métrica-estrela: conversas com o decisor.
          </p>
        </div>
        <Button
          onClick={() => setModal(true)}
          className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" /> Registrar atividade
        </Button>
      </div>

      {loading ? (
        <div className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : !panel ? (
        <p className="mt-10 text-sm text-muted-foreground">
          Não foi possível carregar o painel.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {/* TIME — totais do dia */}
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Time — hoje</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {KPIS.map((k) => (
                  <div key={k.key}>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {k.star && <Star className="size-3 text-primary" />}
                      {k.label}
                    </div>
                    <div className="mt-1 font-mono text-2xl font-semibold text-foreground">
                      {panel.team[k.key]}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* FORECAST */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <TrendingUp className="size-4 text-primary" /> Forecast do mês
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-8">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Reuniões no mês
                  </div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-foreground">
                    {panel.forecast.reunioesMes}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Projeção no ritmo atual
                  </div>
                  <div
                    className={
                      "mt-1 font-mono text-2xl font-semibold " +
                      tone(panel.forecast.projecaoMes, panel.metaReunioesMes)
                    }
                  >
                    {panel.forecast.projecaoMes}
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      / meta {panel.metaReunioesMes}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* POR SDR */}
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">
              Por SDR — atividade vs meta (dia)
            </h2>
            {panel.sdrs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma atividade registrada hoje. Clique em{" "}
                  <strong>Registrar atividade</strong> para começar.
                </CardContent>
              </Card>
            ) : (
              panel.sdrs.map((s) => (
                <Card key={s.user_id}>
                  <CardContent className="py-4">
                    <div className="mb-3 font-semibold text-foreground">
                      {s.name}
                    </div>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                      {KPIS.map((k) => {
                        const meta = panel.metas[k.key];
                        const val = s[k.key];
                        const pct = meta > 0 ? Math.min(100, (val / meta) * 100) : 0;
                        return (
                          <div key={k.key}>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              {k.star && <Star className="size-3 text-primary" />}
                              {k.label}
                            </div>
                            <div className="mt-0.5 font-mono text-sm">
                              <span className={"font-semibold " + tone(val, meta)}>
                                {val}
                              </span>
                              <span className="text-muted-foreground">
                                {" "}
                                / {meta}
                              </span>
                            </div>
                            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* MODAL registrar atividade */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !saving && setModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground">
              Registrar atividade
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Tipo</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="call">Ligação</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">E-mail</option>
                  <option value="meeting">Reunião agendada</option>
                  <option value="qualification">Lead qualificado</option>
                </select>
              </div>
              {tipo === "call" && (
                <div>
                  <label className="text-xs text-muted-foreground">
                    Resultado da ligação
                  </label>
                  <select
                    value={resultado}
                    onChange={(e) => setResultado(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="no_answer">Não atendeu</option>
                    <option value="connected">Atendeu (conversa)</option>
                    <option value="decision_maker">Falou com o decisor</option>
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground">
                  Observação (opcional)
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                  placeholder="Ex.: retornar amanhã 14h"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setModal(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                onClick={registrar}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Registrar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
