'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Megaphone, RefreshCw, Ruler, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  suggestedChannels,
  touchLabel,
  type AcquisitionChannel,
  type Touch,
} from '@/lib/acquisition/channels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { AcquisitionChannelsEditor } from './acquisition-channels-editor';
import { changedChannels } from '@/lib/acquisition/assign';
import { AcquisitionCostsCard } from './acquisition-costs-card';

/**
 * Aquisição — a régua da CONTA para o relatório de aquisição (migration 112).
 *
 * Receita = só o que o time registra no CRM (negócio ganho + valor). Aqui a
 * conta define quem leva o crédito, quais funis ficam de fora, quais canais
 * ela tem (e como cada lead cai num deles) e de quais contas de anúncio o
 * gasto é puxado. Nada disso é global.
 */

interface Settings {
  attribution_model: 'first_touch' | 'last_touch';
  attribution_window_days: number;
  require_value_on_won: boolean;
  excluded_pipeline_ids: string[];
  margin_pct: number | null;
  commission_pct: number | null;
}

interface AdAccount {
  id: string;
  external_id: string;
  name: string | null;
  active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
  channel_id: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  attribution_model: 'first_touch',
  attribution_window_days: 90,
  require_value_on_won: false,
  excluded_pipeline_ids: [],
  margin_pct: null,
  commission_pct: null,
};

const selectCls =
  'h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60';

function pctOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

export function AcquisitionSettings() {
  const supabase = useMemo(() => createClient(), []);
  const { accountId, canEditSettings, defaultCurrency } = useAuth();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>(
    []
  );
  const [channels, setChannels] = useState<AcquisitionChannel[]>([]);
  const [touches, setTouches] = useState<(Touch & { n: number })[]>([]);
  const [pipelineDeals, setPipelineDeals] = useState<Record<string, number>>(
    {}
  );
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [newAd, setNewAd] = useState({ external_id: '', name: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const [s, p, c, t, ad, dl] = await Promise.all([
      supabase
        .from('acquisition_settings')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('pipelines')
        .select('id, name')
        .eq('account_id', accountId)
        .order('name'),
      supabase
        .from('acquisition_channels')
        .select('*')
        .eq('account_id', accountId)
        .order('position'),
      supabase
        .from('lead_attribution')
        .select('source, utm_source, utm_medium')
        .eq('account_id', accountId)
        .gte('created_at', since)
        .limit(5000),
      supabase
        .from('ad_accounts')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at'),
      supabase
        .from('deals')
        .select('pipeline_id')
        .eq('account_id', accountId)
        .gte('created_at', since)
        .limit(10000),
    ]);
    if (s.data)
      setSettings({ ...DEFAULT_SETTINGS, ...(s.data as Partial<Settings>) });
    setPipelines((p.data as { id: string; name: string }[]) ?? []);
    setChannels((c.data as AcquisitionChannel[]) ?? []);
    setAdAccounts((ad.data as AdAccount[]) ?? []);
    // Origens distintas dos últimos 90 dias, com contagem.
    const m = new Map<string, Touch & { n: number }>();
    for (const r of (t.data as Touch[]) ?? []) {
      const k = touchLabel(r);
      const cur = m.get(k);
      if (cur) cur.n++;
      else m.set(k, { ...r, n: 1 });
    }
    setTouches([...m.values()].sort((a, b) => b.n - a.n));
    const porFunil: Record<string, number> = {};
    for (const d of (dl.data as { pipeline_id: string | null }[]) ?? []) {
      if (d.pipeline_id)
        porFunil[d.pipeline_id] = (porFunil[d.pipeline_id] ?? 0) + 1;
    }
    setPipelineDeals(porFunil);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------------- régua ----------------
  async function saveSettings() {
    if (!accountId) return;
    setSavingSettings(true);
    const { error } = await supabase.from('acquisition_settings').upsert({
      account_id: accountId,
      ...settings,
      updated_at: new Date().toISOString(),
    });
    setSavingSettings(false);
    if (error) {
      toast.error('Falha ao salvar a régua');
      return;
    }
    toast.success('Régua salva');
  }

  function toggleExcluded(id: string) {
    setSettings((s) => ({
      ...s,
      excluded_pipeline_ids: s.excluded_pipeline_ids.includes(id)
        ? s.excluded_pipeline_ids.filter((x) => x !== id)
        : [...s.excluded_pipeline_ids, id],
    }));
  }

  // ---------------- canais ----------------
  async function createSuggested() {
    if (!accountId) return;
    setBusy('suggest');
    const { error } = await supabase
      .from('acquisition_channels')
      .insert(
        suggestedChannels().map((c) => ({ ...c, account_id: accountId }))
      );
    setBusy(null);
    if (error) {
      toast.error('Falha ao criar os canais');
      return;
    }
    load();
  }

  /** Mudança vinda da tela (origem/funil → canal): salva só o que mudou. */
  async function applyChannels(next: AcquisitionChannel[]) {
    const prev = channels;
    setChannels(next);
    const mudou = changedChannels(prev, next);
    const res = await Promise.all(
      mudou.map((c) =>
        supabase
          .from('acquisition_channels')
          .update({
            match_sources: c.match_sources,
            match_utm_sources: c.match_utm_sources,
            match_utm_mediums: c.match_utm_mediums,
            match_pipeline_ids: c.match_pipeline_ids,
          })
          .eq('id', c.id)
      )
    );
    if (res.some((r) => r.error)) {
      toast.error('Não consegui salvar. Recarreguei a configuração.');
      load();
    }
  }

  async function addChannel(name: string) {
    if (!accountId) return;
    const position = channels.length
      ? Math.max(...channels.map((c) => c.position)) + 1
      : 0;
    const { data, error } = await supabase
      .from('acquisition_channels')
      .insert({ account_id: accountId, name, kind: 'other', position })
      .select('*')
      .single();
    if (error || !data) {
      toast.error('Falha ao criar o canal');
      return;
    }
    setChannels((cs) => [...cs, data as AcquisitionChannel]);
  }

  async function updateChannel(id: string, patch: Partial<AcquisitionChannel>) {
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase
      .from('acquisition_channels')
      .update(patch)
      .eq('id', id);
    if (error) {
      toast.error('Falha ao salvar o canal');
      load();
    }
  }

  async function removeChannel(id: string) {
    const ch = channels.find((c) => c.id === id);
    if (
      ch &&
      !window.confirm(
        `Apagar o canal "${ch.name}"? Os leads dele passam a "Sem canal".`
      )
    )
      return;
    const { error } = await supabase
      .from('acquisition_channels')
      .delete()
      .eq('id', id);
    if (error) {
      // 23503 = há custos lançados neste canal (FK restrict, mig 115).
      toast.error(
        error.code === '23503'
          ? 'Este canal tem custos lançados. Remova ou mova os custos antes.'
          : 'Falha ao remover o canal'
      );
      return;
    }
    setChannels((cs) => cs.filter((c) => c.id !== id));
  }

  // ---------------- contas de anúncio ----------------
  async function addAdAccount() {
    if (!accountId) return;
    const external_id = newAd.external_id.replace(/^act_/i, '').trim();
    if (!/^[0-9]{5,25}$/.test(external_id)) {
      toast.error(
        'Use o ID numérico da conta de anúncio (ex.: 657811041489547)'
      );
      return;
    }
    setBusy('ad');
    const { error } = await supabase.from('ad_accounts').insert({
      account_id: accountId,
      provider: 'meta',
      external_id,
      name: newAd.name.trim() || null,
    });
    setBusy(null);
    if (error) {
      toast.error(
        error.code === '23505'
          ? 'Essa conta já está vinculada'
          : 'Falha ao vincular a conta'
      );
      return;
    }
    setNewAd({ external_id: '', name: '' });
    load();
  }

  async function syncNow() {
    setBusy('sync');
    try {
      const res = await fetch('/api/acquisition/spend-sync', {
        method: 'POST',
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        results?: { ok: boolean; rows?: number }[];
      };
      if (!res.ok || !j.ok) {
        toast.error(
          j.error ? `Falha ao sincronizar: ${j.error}` : 'Falha ao sincronizar'
        );
      } else {
        const falhas = (j.results ?? []).filter((r) => !r.ok).length;
        const linhas = (j.results ?? []).reduce((s, r) => s + (r.rows ?? 0), 0);
        if (falhas) toast.error(`${falhas} conta(s) com erro. Veja abaixo.`);
        else toast.success(`Gasto sincronizado (${linhas} linhas)`);
      }
    } finally {
      setBusy(null);
      load();
    }
  }

  async function setAdChannel(id: string, channel_id: string | null) {
    setAdAccounts((as) =>
      as.map((a) => (a.id === id ? { ...a, channel_id } : a))
    );
    const { error } = await supabase
      .from('ad_accounts')
      .update({ channel_id })
      .eq('id', id);
    if (error) toast.error('Falha ao salvar o canal da conta');
  }

  async function removeAdAccount(id: string) {
    const { error } = await supabase.from('ad_accounts').delete().eq('id', id);
    if (error) {
      toast.error('Falha ao desvincular');
      return;
    }
    setAdAccounts((as) => as.filter((a) => a.id !== id));
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const ro = !canEditSettings;
  const ordered = [...channels].sort((a, b) => a.position - b.position);

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200">
      <SettingsPanelHead
        title="Aquisição"
        description="Configure uma vez e o Relatório de aquisição mostra, por canal, quanto custou e quanto vendeu. Comece pelos canais."
      />

      {/* ---------------- Canais ---------------- */}
      <AcquisitionChannelsEditor
        channels={channels}
        origins={touches}
        pipelines={pipelines.map((p) => ({
          ...p,
          deals: pipelineDeals[p.id] ?? 0,
        }))}
        readOnly={ro}
        busy={busy === 'suggest'}
        onChannelsChange={applyChannels}
        onCreateSuggested={createSuggested}
        onAddChannel={addChannel}
        onRenameChannel={(id, name) => updateChannel(id, { name })}
        onKindChange={(id, kind) => updateChannel(id, { kind })}
        onRemoveChannel={removeChannel}
      />

      {/* ---------------- Contas de anúncio ---------------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Megaphone className="text-primary size-4" /> Contas de anúncio
            (Meta)
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            O gasto destas contas entra no relatório e é atualizado a cada 6
            horas, no canal escolhido ao lado (padrão: o primeiro canal pago). A
            conta precisa estar compartilhada com o Gerenciador de Negócios da
            Sales 3R.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {adAccounts.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nenhuma conta vinculada.
            </p>
          )}
          {!ro && adAccounts.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={syncNow}
              disabled={busy === 'sync'}
            >
              {busy === 'sync' ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 size-4" />
              )}
              Sincronizar agora
            </Button>
          )}
          {adAccounts.map((a) => (
            <div
              key={a.id}
              className="border-border flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate">
                  {a.name || 'Conta de anúncio'}
                </div>
                <div className="text-muted-foreground font-mono text-xs">
                  {a.external_id} ·{' '}
                  {a.last_sync_error
                    ? `erro: ${a.last_sync_error}`
                    : a.last_synced_at
                      ? `sincronizada em ${new Date(a.last_synced_at).toLocaleString('pt-BR')}`
                      : 'ainda não sincronizada'}
                </div>
              </div>
              {ordered.length > 0 && (
                <select
                  value={a.channel_id ?? ''}
                  disabled={ro}
                  onChange={(e) => setAdChannel(a.id, e.target.value || null)}
                  className={selectCls + ' h-8 w-40'}
                  aria-label="Canal que recebe o gasto"
                >
                  <option value="">1º canal pago</option>
                  {ordered.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              {!ro && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAdAccount(a.id)}
                  aria-label="Desvincular"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {!ro && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label className="text-muted-foreground text-xs">
                  ID da conta
                </Label>
                <Input
                  className="h-8 w-48 font-mono text-xs"
                  placeholder="657811041489547"
                  value={newAd.external_id}
                  onChange={(e) =>
                    setNewAd({ ...newAd, external_id: e.target.value })
                  }
                />
              </div>
              <div className="grid min-w-0 flex-1 gap-1">
                <Label className="text-muted-foreground text-xs">
                  Nome (opcional)
                </Label>
                <Input
                  className="h-8"
                  placeholder="Ex.: Conta principal"
                  value={newAd.name}
                  onChange={(e) => setNewAd({ ...newAd, name: e.target.value })}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={addAdAccount}
                disabled={busy === 'ad'}
              >
                {busy === 'ad' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Vincular'
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {/* ---------------- Custos fora da mídia ---------------- */}
      {accountId && (
        <AcquisitionCostsCard
          accountId={accountId}
          channels={ordered}
          currency={defaultCurrency || 'BRL'}
          readOnly={ro}
        />
      )}

      {/* ---------------- Régua ---------------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Ruler className="text-primary size-4" /> Regras do relatório
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Venda é o negócio marcado como <strong>Ganho</strong> pelo time, e
            receita é o valor informado nele. Nada vem de fora do CRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                Quem leva o crédito da venda
              </Label>
              <select
                value={settings.attribution_model}
                disabled={ro}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    attribution_model: e.target
                      .value as Settings['attribution_model'],
                  })
                }
                className={selectCls}
              >
                <option value="first_touch">Primeiro contato do lead</option>
                <option value="last_touch">
                  Último contato antes da venda
                </option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                Janela de atribuição (dias)
              </Label>
              <Input
                type="number"
                min={1}
                max={730}
                disabled={ro}
                value={settings.attribution_window_days}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    attribution_window_days: Math.min(
                      730,
                      Math.max(1, Number(e.target.value) || 90)
                    ),
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Margem bruta (%)</Label>
              <Input
                inputMode="decimal"
                placeholder="não informada"
                disabled={ro}
                value={settings.margin_pct ?? ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    margin_pct: pctOrNull(e.target.value),
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                Comissão de venda (%)
              </Label>
              <Input
                inputMode="decimal"
                placeholder="não informada"
                disabled={ro}
                value={settings.commission_pct ?? ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    commission_pct: pctOrNull(e.target.value),
                  })
                }
              />
            </div>
          </div>

          <label className="text-foreground flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              disabled={ro}
              checked={settings.require_value_on_won}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  require_value_on_won: e.target.checked,
                })
              }
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              Ganho exige valor
              <span className="text-muted-foreground block text-xs">
                Ninguém marca um negócio como ganho sem informar o valor da
                venda. Sem valor, a venda some da receita do relatório.
              </span>
            </span>
          </label>

          {pipelines.length > 0 && (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">
                Funis que ficam fora do relatório
              </Label>
              <div className="flex flex-wrap gap-2">
                {pipelines.map((p) => {
                  const on = settings.excluded_pipeline_ids.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={ro}
                      onClick={() => toggleExcluded(p.id)}
                      className={
                        'rounded-full border px-3 py-1 text-xs transition-colors ' +
                        (on
                          ? 'border-destructive/50 bg-destructive/10 text-destructive line-through'
                          : 'border-border bg-muted text-foreground hover:border-primary')
                      }
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!ro && (
            <Button
              onClick={saveSettings}
              disabled={savingSettings}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {savingSettings ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Salvar régua'
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
