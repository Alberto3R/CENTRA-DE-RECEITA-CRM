'use client';

import { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Waypoints } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  CHANNEL_KINDS,
  classify,
  suggestedChannels,
  type AcquisitionChannel,
  type ChannelKind,
  type Touch,
} from '@/lib/acquisition/channels';
import {
  assignOrigin,
  assignPipeline,
  originLabel,
  originTech,
} from '@/lib/acquisition/assign';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Canais de aquisição, configurados PELA ORIGEM.
 *
 * A pessoa não vê source/utm: vê "Formulário do site · Instagram — 290 leads"
 * e escolhe o canal num menu. Funis sem rastro digital (prospecção, evento)
 * viram canal inteiro. As regras (match_*) são montadas em lib/acquisition/
 * assign.ts. Só apresentação: quem persiste é o pai (onChannelsChange etc.).
 */

export interface Origin extends Touch {
  n: number;
}

export interface PipelineRow {
  id: string;
  name: string;
  deals: number;
}

const KIND_DOT: Record<ChannelKind, string> = {
  paid: 'bg-blue-500',
  organic: 'bg-emerald-500',
  outbound: 'bg-orange-500',
  referral: 'bg-violet-500',
  event: 'bg-pink-500',
  other: 'bg-slate-400',
};

const selectCls =
  'h-8 rounded-lg border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60';

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <span className="bg-primary/15 text-primary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
          {n}
        </span>
        <div>
          <div className="text-foreground text-sm font-semibold">{title}</div>
          <div className="text-muted-foreground text-xs">{hint}</div>
        </div>
      </div>
      <div className="sm:pl-9">{children}</div>
    </div>
  );
}

export function AcquisitionChannelsEditor({
  channels,
  origins,
  pipelines,
  readOnly,
  busy,
  onChannelsChange,
  onCreateSuggested,
  onAddChannel,
  onRenameChannel,
  onKindChange,
  onRemoveChannel,
}: {
  channels: AcquisitionChannel[];
  origins: Origin[];
  pipelines: PipelineRow[];
  readOnly: boolean;
  busy?: boolean;
  onChannelsChange: (next: AcquisitionChannel[]) => void;
  onCreateSuggested: () => void;
  onAddChannel: (name: string) => void;
  onRenameChannel: (id: string, name: string) => void;
  onKindChange: (id: string, kind: ChannelKind) => void;
  onRemoveChannel: (id: string) => void;
}) {
  const [todas, setTodas] = useState(false);
  const [novo, setNovo] = useState('');
  const ordered = useMemo(
    () => [...channels].sort((a, b) => a.position - b.position),
    [channels]
  );

  const total = origins.reduce((s, o) => s + o.n, 0);
  const comCanal = origins
    .filter((o) => classify(channels, o))
    .reduce((s, o) => s + o.n, 0);
  const pct = total ? Math.round((comCanal / total) * 100) : 0;
  const lista = todas ? origins : origins.slice(0, 12);

  if (ordered.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Waypoints className="text-primary size-4" /> Canais de aquisição
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Canal é o caminho por onde o cliente chegou: anúncio, Instagram
            orgânico, prospecção do time, indicação, evento. É por canal que o
            relatório mostra quanto custou e quanto vendeu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {suggestedChannels().map((c) => (
              <span
                key={c.name}
                className="border-border bg-muted text-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
              >
                <span className={cn('size-2 rounded-full', KIND_DOT[c.kind])} />
                {c.name}
              </span>
            ))}
          </div>
          {!readOnly && (
            <Button
              onClick={onCreateSuggested}
              disabled={busy}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Começar com estes canais'
              )}
            </Button>
          )}
          <p className="text-muted-foreground text-xs">
            Dá para renomear, apagar e criar outros depois.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <Waypoints className="text-primary size-4" /> Canais de aquisição
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Diga de qual canal veio cada lead. Toda mudança vale na hora,
          inclusive para os leads antigos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-7">
        {total > 0 && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="text-foreground font-medium">
                {pct === 100
                  ? 'Todos os leads dos últimos 90 dias têm canal'
                  : `${pct}% dos leads dos últimos 90 dias têm canal`}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {comCanal} de {total}
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className={cn(
                  'h-full rounded-full',
                  pct === 100 ? 'bg-emerald-500' : 'bg-primary'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        <Step
          n={1}
          title="De onde vêm seus leads"
          hint="Cada linha é um jeito que os leads chegaram nos últimos 90 dias. Escolha o canal de cada um."
        >
          {origins.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum lead com origem registrada nos últimos 90 dias.
            </p>
          ) : (
            <div className="divide-border border-border divide-y rounded-lg border">
              {lista.map((o) => {
                const atual = classify(channels, o);
                return (
                  <div
                    key={originTech(o)}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground text-sm">
                        {originLabel(o)}
                      </div>
                      <div
                        className="text-muted-foreground font-mono text-[11px]"
                        title="Detalhe técnico"
                      >
                        {originTech(o)}
                      </div>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums sm:w-20 sm:text-right">
                      {o.n} {o.n === 1 ? 'lead' : 'leads'}
                    </span>
                    <select
                      aria-label={`Canal de ${originLabel(o)}`}
                      value={atual?.id ?? ''}
                      disabled={readOnly}
                      onChange={(e) =>
                        onChannelsChange(
                          assignOrigin(channels, o, e.target.value || null)
                        )
                      }
                      className={cn(
                        selectCls,
                        'sm:w-48',
                        !atual && 'border-amber-500/60 text-amber-600'
                      )}
                    >
                      <option value="">Sem canal</option>
                      {ordered.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
          {origins.length > 12 && (
            <button
              onClick={() => setTodas((v) => !v)}
              className="text-primary mt-2 text-xs font-medium"
            >
              {todas ? 'Mostrar menos' : `Mostrar todas (${origins.length})`}
            </button>
          )}
        </Step>

        {pipelines.length > 0 && (
          <Step
            n={2}
            title="Funis que são um canal"
            hint="Para o que não tem rastro digital. Ex.: tudo que entra no funil Prospecção Ativa conta como Prospecção ativa, venha de onde vier."
          >
            <div className="divide-border border-border divide-y rounded-lg border">
              {pipelines.map((p) => {
                const dono = ordered.find((c) =>
                  c.match_pipeline_ids.includes(p.id)
                );
                return (
                  <div
                    key={p.id}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
                  >
                    <div className="text-foreground min-w-0 flex-1 text-sm">
                      Funil {p.name}
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums sm:w-20 sm:text-right">
                      {p.deals} {p.deals === 1 ? 'negócio' : 'negócios'}
                    </span>
                    <select
                      aria-label={`Canal do funil ${p.name}`}
                      value={dono?.id ?? ''}
                      disabled={readOnly}
                      onChange={(e) =>
                        onChannelsChange(
                          assignPipeline(channels, p.id, e.target.value || null)
                        )
                      }
                      className={cn(selectCls, 'sm:w-48')}
                    >
                      <option value="">Pela origem do lead</option>
                      {ordered.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </Step>
        )}

        <Step
          n={pipelines.length > 0 ? 3 : 2}
          title="Seus canais"
          hint="Renomeie, mude o tipo ou crie um canal novo."
        >
          <div className="space-y-2">
            {ordered.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2.5 shrink-0 rounded-full',
                    KIND_DOT[c.kind]
                  )}
                  aria-hidden
                />
                <Input
                  key={`${c.id}-${c.name}`}
                  defaultValue={c.name}
                  disabled={readOnly}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== c.name) onRenameChannel(c.id, v);
                  }}
                  className="h-8 min-w-0 flex-1"
                  aria-label="Nome do canal"
                />
                <select
                  value={c.kind}
                  disabled={readOnly}
                  onChange={(e) =>
                    onKindChange(c.id, e.target.value as ChannelKind)
                  }
                  className={cn(selectCls, 'w-40')}
                  aria-label="Tipo do canal"
                >
                  {CHANNEL_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveChannel(c.id)}
                    aria-label={`Apagar ${c.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <form
                className="flex items-center gap-2 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (novo.trim()) {
                    onAddChannel(novo.trim());
                    setNovo('');
                  }
                }}
              >
                <span className="size-2.5 shrink-0" />
                <Input
                  value={novo}
                  onChange={(e) => setNovo(e.target.value)}
                  placeholder="Novo canal (ex.: Google Ads, Parceiros)"
                  className="h-8 min-w-0 flex-1"
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={!novo.trim()}
                >
                  <Plus className="mr-1 size-4" /> Criar
                </Button>
              </form>
            )}
          </div>
        </Step>
      </CardContent>
    </Card>
  );
}
