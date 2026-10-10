'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Smartphone, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { WhatsAppConfig } from '@/types';

/**
 * "Conectar WhatsApp do celular" — Coexistência da Meta via Embedded Signup
 * (v4). O número continua no app WhatsApp Business do vendedor e passa a
 * aparecer no CRM, com até 180 dias de histórico.
 *
 * Só aparece com NEXT_PUBLIC_META_APP_ID + NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID
 * (configuração do Facebook Login for Business com o onboarding do app
 * Business habilitado, num app da Meta que seja Tech Provider).
 */

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID;
const GRAPH_VERSION = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || 'v25.0';

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}
interface FbSdk {
  init: (opts: Record<string, unknown>) => void;
  login: (cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>) => void;
}
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FbSdk> | null = null;
function loadFacebookSdk(): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) {
      resolve(window.FB);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(window.FB!);
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Não consegui carregar o SDK da Meta (bloqueador de anúncios?).'));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

export function isCoexistenceAvailable(): boolean {
  return Boolean(APP_ID && CONFIG_ID);
}

export function CoexistenceConnect({ onConnected }: { onConnected: () => void }) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  // O popup devolve o code (callback do FB.login) e os IDs (postMessage) em
  // ordem não garantida — junta os dois antes de chamar o back.
  const pending = useRef<{ code?: string; phoneNumberId?: string; wabaId?: string }>({});
  const finishing = useRef(false);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith('facebook.com')) return;
      let data: { type?: string; event?: string; data?: Record<string, string> };
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'CANCEL') {
        setBusy(false);
        return;
      }
      if (data.data?.phone_number_id) pending.current.phoneNumberId = data.data.phone_number_id;
      if (data.data?.waba_id) pending.current.wabaId = data.data.waba_id;
      void tryFinish();
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tryFinish() {
    const { code, phoneNumberId, wabaId } = pending.current;
    if (!code || !phoneNumberId || !wabaId || finishing.current) return;
    finishing.current = true;
    try {
      const res = await fetch('/api/whatsapp/coexistence/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, phone_number_id: phoneNumberId, waba_id: wabaId, label }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || 'Falha ao conectar o WhatsApp do celular.');
        return;
      }
      if (json.sync?.error) {
        toast.warning(
          `Número conectado, mas a importação do histórico falhou: ${json.sync.error}`,
        );
      } else {
        toast.success('WhatsApp do celular conectado. O histórico está sendo importado.');
      }
      setLabel('');
      onConnected();
    } finally {
      pending.current = {};
      finishing.current = false;
      setBusy(false);
    }
  }

  async function handleConnect() {
    setBusy(true);
    pending.current = {};
    try {
      const FB = await loadFacebookSdk();
      FB.login(
        (response) => {
          const code = response.authResponse?.code;
          if (!code) {
            setBusy(false);
            return;
          }
          pending.current.code = code;
          void tryFinish();
        },
        {
          config_id: CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
          },
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao abrir a conexão da Meta.');
      setBusy(false);
    }
  }

  if (!isCoexistenceAvailable()) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="size-4 text-primary" />
          Conectar WhatsApp do celular
        </CardTitle>
        <CardDescription>
          O número continua funcionando no app WhatsApp Business do vendedor e as
          conversas passam a aparecer aqui, inclusive o que ele mandar pelo celular.
          Traz até 6 meses de histórico. Não traz grupos.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="coex-label">Nome do canal</Label>
          <Input
            id="coex-label"
            placeholder="Ex.: SDR Ana Clara"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
          />
        </div>
        <Button onClick={handleConnect} disabled={busy}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Conectar pelo app
        </Button>
      </CardContent>
    </Card>
  );
}

/** Estado da importação de um canal em coexistência. */
export function CoexistenceStatus({ config }: { config: WhatsAppConfig | null }) {
  if (!config || config.connection_mode !== 'coexistence') return null;
  const done = Boolean(config.coex_history_completed_at);
  const progress = config.coex_history_progress;
  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Smartphone className="size-4 text-primary" />
        Número do app WhatsApp Business (coexistência)
      </div>
      <p className="mt-1 text-muted-foreground">
        O vendedor segue usando o celular. Mensagens enviadas por lá aparecem aqui
        marcadas como “pelo celular”. Flows e automações não respondem neste número.
      </p>
      {config.coex_last_error ? (
        <p className="mt-2 flex items-start gap-1.5 text-amber-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {config.coex_last_error}
        </p>
      ) : done ? (
        <p className="mt-2 flex items-center gap-1.5 text-emerald-500">
          <CheckCircle2 className="size-4" /> Histórico importado.
        </p>
      ) : config.coex_history_sync_requested_at ? (
        <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Importando histórico{typeof progress === 'number' ? ` · ${progress}%` : '…'}
        </p>
      ) : null}
    </div>
  );
}
