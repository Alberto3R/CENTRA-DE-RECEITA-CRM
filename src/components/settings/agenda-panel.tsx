'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, Check, Loader2, Video } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

interface Status {
  connected: boolean;
  google_email: string | null;
}
interface Config {
  enabled: boolean;
  timezone: string;
  slot_minutes: number;
  buffer_minutes: number;
  advance_days: number;
  business_hours: { days: number[]; start: string; end: string };
}

const DIAS: { n: number; l: string }[] = [
  { n: 1, l: 'Seg' },
  { n: 2, l: 'Ter' },
  { n: 3, l: 'Qua' },
  { n: 4, l: 'Qui' },
  { n: 5, l: 'Sex' },
  { n: 6, l: 'Sáb' },
  { n: 7, l: 'Dom' },
];

export function AgendaPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [s, c] = await Promise.all([
      fetch('/api/google/status').then((r) => r.json()).catch(() => null),
      fetch('/api/scheduling/config').then((r) => r.json()).catch(() => null),
    ]);
    if (s) setStatus(s);
    if (c) setCfg(c);
  }

  useEffect(() => {
    load();
    // Feedback do retorno do OAuth (?google=connected|error|no_refresh)
    const g = new URLSearchParams(window.location.search).get('google');
    if (g === 'connected') toast.success('Agenda Google conectada 🎉');
    else if (g === 'no_refresh')
      toast.error('Google não devolveu autorização de longo prazo. Tente conectar de novo.');
    else if (g === 'error') toast.error('Não foi possível conectar a agenda Google.');
    if (g) window.history.replaceState({}, '', '/settings?tab=agenda');
  }, []);

  async function disconnect() {
    const res = await fetch('/api/google/disconnect', { method: 'POST' });
    if (res.ok) {
      toast.success('Agenda desconectada.');
      setStatus({ connected: false, google_email: null });
    } else {
      toast.error('Falha ao desconectar.');
    }
  }

  async function save() {
    if (!cfg) return;
    if (cfg.business_hours.days.length === 0) {
      toast.error('Escolha pelo menos um dia de atendimento.');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/scheduling/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    setSaving(false);
    if (res.ok) toast.success('Regras de agenda salvas.');
    else toast.error('Falha ao salvar.');
  }

  function toggleDay(n: number) {
    if (!cfg) return;
    const has = cfg.business_hours.days.includes(n);
    const days = has
      ? cfg.business_hours.days.filter((d) => d !== n)
      : [...cfg.business_hours.days, n].sort((a, b) => a - b);
    setCfg({ ...cfg, business_hours: { ...cfg.business_hours, days } });
  }

  return (
    <div className="space-y-6">
      {/* Conexão */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" /> Agenda Google
          </CardTitle>
          <CardDescription>
            Conecte a agenda do Especialista. Com ela ligada, o agente de IA vê os horários
            livres, cria o evento com <span className="inline-flex items-center gap-1"><Video className="h-3.5 w-3.5" />Google Meet</span> e manda o link pro lead — direto na conversa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : status.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Badge className="gap-1 bg-emerald-600/15 text-emerald-600">
                  <Check className="h-3.5 w-3.5" /> Conectada
                </Badge>
                <span className="text-muted-foreground">{status.google_email}</span>
              </div>
              <Button variant="outline" size="sm" onClick={disconnect}>
                Desconectar
              </Button>
            </div>
          ) : (
            <Button onClick={() => (window.location.href = '/api/google/connect')}>
              Conectar Google Agenda
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Regras */}
      {cfg && (
        <Card>
          <CardHeader>
            <CardTitle>Regras de agendamento</CardTitle>
            <CardDescription>
              Como o agente oferece e marca as calls.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <Label>Agendamento pelo agente</Label>
                <p className="text-xs text-muted-foreground">
                  Desligue para o agente só fazer handoff humano.
                </p>
              </div>
              <Switch
                checked={cfg.enabled}
                onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="slot">Duração (min)</Label>
                <Input
                  id="slot"
                  type="number"
                  value={cfg.slot_minutes}
                  onChange={(e) => setCfg({ ...cfg, slot_minutes: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="buffer">Intervalo entre calls (min)</Label>
                <Input
                  id="buffer"
                  type="number"
                  value={cfg.buffer_minutes}
                  onChange={(e) => setCfg({ ...cfg, buffer_minutes: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label htmlFor="adv">Ofertar até (dias à frente)</Label>
                <Input
                  id="adv"
                  type="number"
                  value={cfg.advance_days}
                  onChange={(e) => setCfg({ ...cfg, advance_days: Number(e.target.value) })}
                />
              </div>
            </div>

            <div>
              <Label>Dias de atendimento</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {DIAS.map((d) => {
                  const on = cfg.business_hours.days.includes(d.n);
                  return (
                    <button
                      key={d.n}
                      type="button"
                      onClick={() => toggleDay(d.n)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="start">Início</Label>
                <Input
                  id="start"
                  type="time"
                  value={cfg.business_hours.start}
                  onChange={(e) =>
                    setCfg({ ...cfg, business_hours: { ...cfg.business_hours, start: e.target.value } })
                  }
                />
              </div>
              <div>
                <Label htmlFor="end">Fim</Label>
                <Input
                  id="end"
                  type="time"
                  value={cfg.business_hours.end}
                  onChange={(e) =>
                    setCfg({ ...cfg, business_hours: { ...cfg.business_hours, end: e.target.value } })
                  }
                />
              </div>
              <div>
                <Label htmlFor="tz">Fuso</Label>
                <Input
                  id="tz"
                  value={cfg.timezone}
                  onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…
                  </>
                ) : (
                  'Salvar regras'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
