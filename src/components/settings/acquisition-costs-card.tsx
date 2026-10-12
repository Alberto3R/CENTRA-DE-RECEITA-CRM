"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Receipt, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { AcquisitionChannel } from "@/lib/acquisition/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Custos fora da mídia (migration 115): SDR, vendedor, estande, agência,
 * ferramenta. Lançados por MÊS e por CANAL; o relatório rateia pelos dias do
 * período e soma ao investimento do canal. É o que tira o custo da prospecção
 * e dos eventos do "—".
 */

interface Cost {
  id: string;
  channel_id: string;
  month: string;
  label: string;
  amount: number;
}

const selectCls =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function AcquisitionCostsCard({
  accountId,
  channels,
  currency,
  readOnly,
}: {
  accountId: string;
  channels: AcquisitionChannel[];
  currency: string;
  readOnly: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ month: thisMonth(), channel_id: "", label: "", amount: "" });

  const money = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);

  const load = useCallback(async () => {
    const since = new Date();
    since.setMonth(since.getMonth() - 12, 1);
    const { data } = await supabase
      .from("acquisition_costs")
      .select("id, channel_id, month, label, amount")
      .eq("account_id", accountId)
      .gte("month", since.toISOString().slice(0, 10))
      .order("month", { ascending: false })
      .order("created_at", { ascending: true });
    setCosts(((data as Cost[]) ?? []).map((c) => ({ ...c, amount: Number(c.amount) })));
    setLoaded(true);
  }, [supabase, accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial (padrão do repo)
    load();
  }, [load]);

  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? "canal removido";

  async function add() {
    const amount = Number(form.amount.replace(/\./g, "").replace(",", "."));
    const channel_id = form.channel_id || channels[0]?.id;
    if (!channel_id) return toast.error("Crie um canal antes de lançar custos");
    if (!form.label.trim()) return toast.error("Descreva o custo (ex.: salário da SDR)");
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Valor inválido");
    setSaving(true);
    const { error } = await supabase.from("acquisition_costs").insert({
      account_id: accountId,
      channel_id,
      month: `${form.month}-01`,
      label: form.label.trim(),
      amount,
    });
    setSaving(false);
    if (error) return toast.error("Falha ao lançar o custo");
    setForm({ ...form, label: "", amount: "" });
    toast.success("Custo lançado");
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("acquisition_costs").delete().eq("id", id);
    if (error) return toast.error("Falha ao remover o custo");
    setCosts((cs) => cs.filter((c) => c.id !== id));
  }

  // Agrupa por mês para a lista.
  const byMonth = useMemo(() => {
    const m = new Map<string, Cost[]>();
    for (const c of costs) {
      const k = c.month.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [costs]);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Receipt className="size-4 text-primary" /> Custos fora da mídia
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Time, eventos, agência, ferramentas: tudo o que a conta gasta para vender e que não é anúncio.
          Lance por mês e por canal. O relatório rateia pelos dias do período e soma ao investimento do
          canal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">Crie os canais acima antes de lançar custos.</p>
        ) : (
          !readOnly && (
            <div className="grid gap-2 sm:grid-cols-[130px_1fr_1.4fr_120px_auto] sm:items-end">
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Mês</Label>
                <Input
                  type="month"
                  className="h-9"
                  value={form.month}
                  onChange={(e) => setForm({ ...form, month: e.target.value || thisMonth() })}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Canal</Label>
                <select
                  className={selectCls}
                  value={form.channel_id || channels[0]?.id}
                  onChange={(e) => setForm({ ...form, channel_id: e.target.value })}
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Descrição</Label>
                <Input
                  className="h-9"
                  placeholder="Ex.: salário da SDR"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Valor</Label>
                <Input
                  className="h-9"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <Button onClick={add} disabled={saving} variant="outline" className="h-9">
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Lançar"}
              </Button>
            </div>
          )
        )}

        {!loaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </div>
        ) : byMonth.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum custo lançado nos últimos 12 meses.</p>
        ) : (
          byMonth.map(([month, items]) => (
            <div key={month}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-medium capitalize text-foreground">{monthLabel(month)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {money(items.reduce((s, c) => s + c.amount, 0))}
                </span>
              </div>
              <div className="divide-y divide-border rounded-lg border border-border">
                {items.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">{c.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{channelName(c.channel_id)}</span>
                    <span className="w-28 shrink-0 text-right tabular-nums text-foreground">{money(c.amount)}</span>
                    {!readOnly && (
                      <Button variant="ghost" size="sm" onClick={() => remove(c.id)} aria-label="Remover custo">
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
