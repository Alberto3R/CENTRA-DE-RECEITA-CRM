"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  SlidersHorizontal,
  Star,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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
  whatsapp: number;
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
interface CadItem {
  id: string;
  passo: number;
  canal: string;
  total: number;
  atrasado: boolean;
  titulo: string;
  contato: string;
}

const KPIS: { key: keyof Kpis; label: string; star?: boolean }[] = [
  { key: "dials", label: "Ligações" },
  { key: "atendimentos", label: "Atendimentos" },
  { key: "decisor", label: "Conversas c/ decisor", star: true },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "reunioes", label: "Reuniões agendadas" },
  { key: "qualificados", label: "Leads qualificados" },
];

const META_FIELDS: { key: string; label: string }[] = [
  { key: "dials", label: "Ligações/dia" },
  { key: "atendimentos", label: "Atendimentos/dia" },
  { key: "decisor", label: "Conversas c/ decisor/dia" },
  { key: "whatsapp", label: "WhatsApp/dia" },
  { key: "reunioes", label: "Reuniões/dia" },
  { key: "qualificados", label: "Qualificados/dia" },
  { key: "reunioes_mes", label: "Reuniões/mês (time)" },
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
  const [cadence, setCadence] = useState<CadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [tipo, setTipo] = useState("call");
  const [resultado, setResultado] = useState("no_answer");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { canEditSettings } = useAuth();
  const [metasModal, setMetasModal] = useState(false);
  const [metasForm, setMetasForm] = useState<Record<string, number>>({});
  const [savingMetas, setSavingMetas] = useState(false);

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

  const loadCadence = useCallback(async () => {
    try {
      const res = await fetch("/api/outbound/cadence");
      const data = await res.json();
      if (res.ok) setCadence((data.items as CadItem[]) ?? []);
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    load();
    loadCadence();
  }, [load, loadCadence]);

  async function avancar(id: string) {
    try {
      const res = await fetch("/api/outbound/cadence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
      await loadCadence();
    } catch {
      toast.error("Não foi possível avançar o toque");
    }
  }

  function abrirMetas() {
    if (!panel) return;
    setMetasForm({
      ...panel.metas,
      reunioes_mes: panel.metaReunioesMes,
    } as Record<string, number>);
    setMetasModal(true);
  }
  async function salvarMetas() {
    setSavingMetas(true);
    try {
      const res = await fetch("/api/outbound/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metasForm),
      });
      if (!res.ok) throw new Error();
      toast.success("Metas atualizadas");
      setMetasModal(false);
      await load();
    } catch {
      toast.error("Não foi possível salvar as metas");
    } finally {
      setSavingMetas(false);
    }
  }

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
        <div className="flex shrink-0 gap-2">
          {canEditSettings && (
            <Button variant="outline" onClick={abrirMetas}>
              <SlidersHorizontal className="size-4" /> Metas
            </Button>
          )}
          <Button
            onClick={() => setModal(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" /> Registrar atividade
          </Button>
        </div>
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
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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

          {/* PRÓXIMOS PASSOS (cadência) */}
          {cadence.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">
                  Próximos passos — hoje ({cadence.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {cadence.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {c.contato}
                        {c.atrasado && (
                          <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                            ATRASADO
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Passo {c.passo + 1}/{c.total} ·{" "}
                        <span className="text-primary">{c.canal}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => avancar(c.id)}
                      className="shrink-0"
                    >
                      Feito →
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

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
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
                  <option value="email">E-mail</option>
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
              <p className="text-xs text-muted-foreground">
                WhatsApp, reuniões e qualificações são registrados automaticamente
                (envio no inbox e mudança de etapa do lead).
              </p>
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

      {/* MODAL editar metas */}
      {metasModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !savingMetas && setMetasModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground">
              Metas do time
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Valores diários por SDR; reuniões/mês é a meta mensal do time.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {META_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-muted-foreground">
                    {f.label}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={metasForm[f.key] ?? 0}
                    onChange={(e) =>
                      setMetasForm((s) => ({
                        ...s,
                        [f.key]: Number(e.target.value),
                      }))
                    }
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setMetasModal(false)}
                disabled={savingMetas}
              >
                Cancelar
              </Button>
              <Button
                onClick={salvarMetas}
                disabled={savingMetas}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {savingMetas ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Salvar metas"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
