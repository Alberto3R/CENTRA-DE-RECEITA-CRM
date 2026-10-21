'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, QrCode, RefreshCw, Smartphone, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { WhatsAppConfig } from '@/types';

/**
 * Canal de WhatsApp conectado por QR code (Z-API, migration 120).
 *
 * O cliente abre o WhatsApp Business do celular → Aparelhos conectados →
 * Conectar um aparelho e aponta para o QR desta tela, igual ao WhatsApp Web.
 * O WhatsApp troca o QR a cada ~20 s: a tela pede de novo a cada 10 s (a
 * mesma chamada já diz se conectou) e, depois de ~1 min sem leitura, para e
 * oferece "Gerar novo QR" — evita chamadas à toa.
 */

const POLL_MS = 10_000;
const MAX_POLLS = 6;

interface QrState {
  connected: boolean;
  phone?: string | null;
  qr?: string | null;
  challenge?: boolean;
  lastError?: string | null;
}

export function QrChannelPanel({
  channel,
  onChange,
}: {
  channel: WhatsAppConfig;
  onChange: () => void;
}) {
  const [state, setState] = useState<QrState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasConnected = useRef(channel.status === 'connected');
  // O pai recria onChange a cada render; com ref, `load` não muda junto e o
  // efeito de carga não dispara de novo à toa.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/qr/${channel.id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Não consegui falar com a Z-API.');
        return;
      }
      setError(null);
      setState(json as QrState);
      if (json.connected && !wasConnected.current) {
        wasConnected.current = true;
        toast.success('WhatsApp conectado.');
        onChangeRef.current();
      }
      if (!json.connected) wasConnected.current = false;
    } catch {
      setError('Não consegui falar com a Z-API.');
    } finally {
      setLoading(false);
    }
  }, [channel.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Enquanto o QR está na tela: pede de novo a cada 10 s, até ~1 min.
  const waitingScan = Boolean(state && !state.connected && state.qr);
  useEffect(() => {
    if (!waitingScan || polls >= MAX_POLLS) return;
    const t = setTimeout(() => {
      setPolls((p) => p + 1);
      void load();
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [waitingScan, polls, load]);

  function restartQr() {
    setPolls(0);
    setLoading(true);
    void load();
  }

  async function requestCode() {
    setBusy(true);
    setCode(null);
    try {
      const res = await fetch(`/api/whatsapp/qr/${channel.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'phone-code', phone }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Não consegui gerar o código.');
        return;
      }
      if (json.challenge || !json.code) {
        toast.error('Este celular pede chave de acesso. Conecte pelo QR code.');
        return;
      }
      setCode(json.code);
      setPolls(0);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Desconectar este WhatsApp da Central? As conversas param de entrar até escanear de novo.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/whatsapp/qr/${channel.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Não consegui desconectar.');
        return;
      }
      toast.success('WhatsApp desconectado.');
      wasConnected.current = false;
      onChangeRef.current();
      restartQr();
    } finally {
      setBusy(false);
    }
  }

  if (loading && !state) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (state?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-foreground">
            <CheckCircle2 className="size-5 text-emerald-500" />
            WhatsApp conectado
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {state.phone ? `${state.phone} · ` : ''}As conversas deste número entram na Central,
            inclusive o que for mandado pelo celular.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Conexão por QR code: não tem modelos, disparo em massa nem ligação. Use para
            atender quem chama — nada de mensagem em massa para quem não conhece a loja.
          </p>
          <Button variant="outline" onClick={handleDisconnect} disabled={busy}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Desconectar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const expired = polls >= MAX_POLLS;

  // Container query, não breakpoint da janela: a área de Configurações fica
  // estreita mesmo em tela de 1024 px (menu lateral + menu de seções), e o
  // QR espremido numa coluna fina não dá para escanear.
  return (
    <div className="@container">
    <div className="grid gap-6 @3xl:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-foreground">
            <QrCode className="size-5 text-primary" />
            Conectar por QR code
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            No celular da loja: WhatsApp Business → <strong>Aparelhos conectados</strong> →{' '}
            <strong>Conectar um aparelho</strong> e aponte a câmera para o QR abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p className="flex items-start gap-1.5 text-sm text-amber-500">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
          {state?.lastError ? (
            <p className="text-sm text-muted-foreground">Última queda: {state.lastError}</p>
          ) : null}

          {state?.challenge ? (
            <p className="text-sm text-amber-500">
              Este celular pede chave de acesso em vez de QR code. Fale com o suporte da
              Sales 3R para concluir a conexão.
            </p>
          ) : expired ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm text-muted-foreground">O QR expirou.</p>
              <Button onClick={restartQr}>
                <RefreshCw className="mr-2 size-4" />
                Gerar novo QR
              </Button>
            </div>
          ) : state?.qr ? (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.qr}
                alt="QR code para conectar o WhatsApp"
                className="size-64 rounded-lg bg-white p-2"
              />
              <p className="text-xs text-muted-foreground">
                O QR muda sozinho a cada poucos segundos. Esta tela avisa quando conectar.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-foreground">
            <Smartphone className="size-4 text-primary" />
            Sem computador por perto?
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Gere um código e digite no celular: Aparelhos conectados → Conectar um aparelho →{' '}
            <strong>Conectar com número de telefone</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qr-phone">Número do WhatsApp da loja</Label>
            <Input
              id="qr-phone"
              placeholder="55 31 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
            />
          </div>
          <Button onClick={requestCode} disabled={busy || !phone.trim()} className="w-full">
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Gerar código
          </Button>
          {code ? (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-center font-mono text-2xl tracking-widest text-foreground">
              {code}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
    </div>
  );
}
