'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

export function WhatsAppConfig() {
  const supabase = createClient();
  // After multi-user, whatsapp_config is one-row-per-account, not
  // one-row-per-user. We pull `accountId` straight off the auth
  // context and key every read off it — so a teammate who just
  // joined an account sees the inviter's saved config without
  // having to re-enter anything.
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  // Multi-canal: lista de canais da conta + qual está selecionado no formulário.
  // `mode` = 'edit' edita o canal selecionado; 'new' adiciona um canal.
  const [channels, setChannels] = useState<WhatsAppConfigType[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'new'>('edit');
  const [label, setLabel] = useState('');
  // Ref espelhando a seleção — lido dentro de fetchConfig (deps [supabase])
  // sem virar dependência (evita closure velha e re-render em loop).
  const selRef = useRef<string | null>(null);
  const setSelected = (id: string | null) => {
    selRef.current = id;
    setSelectedChannelId(id);
  };

  // True once /register has succeeded on Meta's side (timestamp set
  // in the row). When false, the saved config is metadata-only and
  // Meta will silently drop every inbound event — that's the
  // multi-number bug that prompted this work.
  const isRegistered = Boolean(config?.registered_at);
  const lastRegistrationError = config?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    errors?: string[];
    last_registration_error?: string | null;
    registered_at?: string | null;
    subscribed_apps_at?: string | null;
  };
  const [registrationProbe, setRegistrationProbe] =
    useState<RegistrationProbe | null>(null);

  // Resultado da última ativação (o save agora diagnostica o número na Meta
  // antes de registrar). `outcome` diz qual é o próximo passo — cada um tem
  // uma remediação diferente e mostrar o erro cru da Meta não ajudava ninguém.
  type ActivationOutcome = {
    outcome:
      | 'already_connected'
      | 'registered'
      | 'needs_pin'
      | 'needs_old_pin'
      | 'needs_code_verification'
      | 'meta_error'
      | 'ambiguous_waba'
      | 'wrong_token_or_bm';
    message?: string;
    candidates?: {
      id: string;
      display_phone_number?: string;
      verified_name?: string;
    }[];
    missingScopes?: string[];
    reachable?: { businessId: string; businessName?: string; wabaIds: string[] }[];
  };
  const [activation, setActivation] = useState<ActivationOutcome | null>(null);

  // CAMINHO B — re-verificação do número por código físico (SMS/ligação).
  const [codeMethod, setCodeMethod] = useState<'SMS' | 'VOICE'>('SMS');
  const [codeSent, setCodeSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [requestingCode, setRequestingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);

  // O painel de re-verificação aparece tanto logo após um save que detectou
  // EXPIRED quanto ao reabrir a página com o canal nesse estado — senão o
  // cliente que fechasse a aba no meio do fluxo não teria como retomar.
  const needsCodeVerification =
    activation?.outcome === 'needs_code_verification' ||
    (config as unknown as { code_verification_status?: string } | null)
      ?.code_verification_status === 'EXPIRED';

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      // Multi-canal: carrega a LISTA de canais da conta (primário primeiro).
      // Só canais de WhatsApp — o Instagram tem sua própria seção (senão o
      // painel tentaria verificar um canal sem phone_number_id na Graph API
      // do WhatsApp → erro "Object with ID 'null'").
      const { data: list, error } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', acctId)
        .eq('channel_type', 'whatsapp')
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Failed to load config rows:', error);
      }

      const rows = (list ?? []) as WhatsAppConfigType[];
      setChannels(rows);

      // Mantém o canal selecionado se ainda existir; senão pega o primário/1º.
      const chosen =
        rows.find((r) => r.id === selRef.current) ?? rows[0] ?? null;

      if (chosen) {
        setSelected(chosen.id);
        setMode('edit');
        setConfig(chosen);
        setPhoneNumberId(chosen.phone_number_id || '');
        setWabaId(chosen.waba_id || '');
        setLabel(
          (chosen as unknown as { label?: string }).label || '',
        );
        setAccessToken(MASKED_TOKEN);
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      } else {
        // Conta sem nenhum canal → formulário de primeiro cadastro.
        setSelected(null);
        setMode('edit');
        setConfig(null);
        setPhoneNumberId('');
        setWabaId('');
        setLabel('');
        setAccessToken('');
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      }
      // Clear any stale probe result when reloading the row.
      setRegistrationProbe(null);

      // Then verify health via the API (decrypts token + pings Meta)
      if (chosen) {
        try {
          const res = await fetch(
            `/api/whatsapp/config?channelId=${chosen.id}`,
            { method: 'GET' },
          );
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          } else {
            setConnectionStatus('disconnected');
            setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
            setStatusMessage(payload.message || '');
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Falha ao carregar a configuração do WhatsApp');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // Need both the auth session (`!authLoading`) AND the profile
    // (`!profileLoading`, which carries `accountId`). Without the
    // second guard, the effect would fire with `accountId === null`
    // for the first render window and bail without ever retrying
    // once the profile arrives.
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      setLoading(false);
      return;
    }
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user, accountId, fetchConfig]);

  // Seleciona um canal existente (recarrega os dados dele no formulário).
  function selectChannel(id: string) {
    selRef.current = id;
    if (accountId) fetchConfig(accountId);
  }

  // Prepara o formulário para ADICIONAR um novo canal (form em branco).
  function startNewChannel() {
    setSelected(null);
    setMode('new');
    setConfig(null);
    setPhoneNumberId('');
    setWabaId('');
    setLabel('');
    setAccessToken('');
    setVerifyToken('');
    setPin('');
    setTokenEdited(false);
    setConnectionStatus('unknown');
    setResetReason(null);
    setStatusMessage('');
    setRegistrationProbe(null);
  }

  async function handleSetPrimary(id: string) {
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: id, makePrimary: true }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Falha ao definir canal primário');
        return;
      }
      toast.success('Canal primário atualizado');
      if (accountId) await fetchConfig(accountId);
    } catch {
      toast.error('Erro de rede');
    }
  }

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast.error('O ID do número de telefone é obrigatório');
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error('O token de acesso é obrigatório na configuração inicial');
      return;
    }

    try {
      setSaving(true);

      // Always POST through the API — it verifies with Meta and encrypts
      // the access_token server-side with ENCRYPTION_KEY. Skipping this
      // and writing direct to Supabase stores the token in plaintext,
      // which then fails decryption on every subsequent health check.
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        // App Secret do App Meta (opcional). Enviado só quando preenchido; sem
        // ele, o webhook cai no fallback do env META_APP_SECRET.
        app_secret: appSecret.trim() || null,
        // Optional — only sent when the user filled it in. The server
        // requires it on first save or when changing numbers; for a
        // simple token rotation, leaving it blank skips re-register.
        pin: pin.trim() || null,
        // Multi-canal: qual canal salvar.
        channelId: mode === 'edit' ? selectedChannelId : null,
        isNew: mode === 'new',
        label: label.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        // Existing config — reuse stored encrypted token by decrypting on the
        // server. But our POST handler requires an access_token to verify
        // with Meta. If the user didn't change the token, we need to signal
        // that. Simplest: require token re-entry if they're updating.
        toast.error('Reinsira o token de acesso para salvar as alterações');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      const act = (data.activation ?? null) as ActivationOutcome | null;
      setActivation(act);
      setCodeSent(false);

      if (!res.ok) {
        // 400 = nada foi salvo (token/BM errado, ou WABA com vários números).
        toast.error(data.error || 'Falha ao salvar a configuração');
        setSaving(false);
        return;
      }

      // O save agora diagnostica antes de registrar, então a resposta diz
      // exatamente em que ponto o número parou. Cada caso tem uma saída
      // diferente — tratar tudo como "erro ao registrar" era o que fazia o
      // cliente ficar preso sem saber o que fazer.
      switch (act?.outcome) {
        case 'already_connected':
          toast.success(
            data.phone_info?.verified_name
              ? `${data.phone_info.verified_name} já estava conectado na Meta.`
              : 'O número já estava conectado na Meta.',
          );
          setPin('');
          break;
        case 'registered':
          toast.success(
            data.phone_info?.verified_name
              ? `Ativado — ${data.phone_info.verified_name} já pode receber eventos.`
              : 'Número ativado na Meta. Os eventos começarão a chegar em até um minuto.',
          );
          setPin('');
          break;
        case 'needs_code_verification':
          toast.warning(
            'A verificação deste número expirou na Meta. Confirme a posse da linha para reativar — veja o passo abaixo.',
            { duration: 12000 },
          );
          break;
        case 'needs_old_pin':
          toast.error(
            'A Meta recusou o PIN. Se o número já teve verificação em duas etapas, só o PIN ANTIGO funciona.',
            { duration: 14000 },
          );
          break;
        case 'needs_pin':
          toast.warning(
            'Credenciais salvas. Informe o PIN de verificação em duas etapas (6 dígitos) para concluir a ativação.',
            { duration: 10000 },
          );
          break;
        default:
          if (data.registration_error) {
            toast.error(
              `Salvo, mas a Meta não conseguiu ativar o número: ${data.registration_error}`,
              { duration: 12000 },
            );
          } else {
            toast.success('Configuração salva.');
          }
      }

      if (data.resolved_phone_number_id) {
        // O cliente colou o WABA ID; resolvemos o número real por trás dele.
        // Vale avisar, senão o campo mudando sozinho parece bug.
        toast.info(
          `O ID informado era um WABA ID. Usamos o número ${data.resolved_phone_number_id}.`,
          { duration: 10000 },
        );
      }

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Falha ao salvar a configuração');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Conectado a ${payload.phone_info.verified_name}`
            : 'Conexão com a API bem-sucedida'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'Falha na conexão com a API');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('O teste de conexão falhou. Verifique a rede e tente novamente.');
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration(opts?: { silent?: boolean }) {
    const silent = opts?.silent === true;
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch('/api/whatsapp/config/verify-registration', {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (!silent) {
        if (data.live) {
          toast.success('O número está totalmente configurado — a Meta está entregando eventos.');
        } else {
          toast.error(
            'O número não está totalmente registrado. Veja as verificações abaixo para saber qual etapa falhou.',
            { duration: 8000 },
          );
        }
      }
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('verify-registration failed:', err);
      if (!silent) {
        toast.error('Não foi possível conectar ao endpoint de verificação.');
      }
    } finally {
      setVerifyingRegistration(false);
    }
  }

  /**
   * CAMINHO B, passo 1 — pede o código à Meta.
   *
   * O código chega no PRÓPRIO NÚMERO (SMS ou ligação). Não há como a API
   * pular isso: se ninguém controla a linha, o número não reativa.
   */
  async function handleRequestCode() {
    try {
      setRequestingCode(true);
      const res = await fetch('/api/whatsapp/config/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannelId,
          code_method: codeMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          [data.error, data.hint].filter(Boolean).join(' '),
          { duration: 12000 },
        );
        return;
      }
      setCodeSent(true);
      toast.success(data.message ?? 'Código solicitado.', { duration: 10000 });
    } catch (err) {
      console.error('request-code failed:', err);
      toast.error('Não foi possível solicitar o código.');
    } finally {
      setRequestingCode(false);
    }
  }

  /** CAMINHO B, passos 2-3 — confirma o código e registra na sequência. */
  async function handleVerifyCode() {
    if (!verificationCode.trim()) {
      toast.error('Informe o código recebido no número.');
      return;
    }
    try {
      setVerifyingCode(true);
      const res = await fetch('/api/whatsapp/config/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannelId,
          code: verificationCode.trim(),
          pin: pin.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Código recusado pela Meta.', { duration: 12000 });
        return;
      }
      if (data.success) {
        toast.success('Número verificado e ativado. Já pode receber eventos.');
        setActivation(null);
        setCodeSent(false);
        setVerificationCode('');
        setPin('');
      } else if (data.outcome === 'needs_pin') {
        toast.warning(data.message, { duration: 12000 });
        setVerificationCode('');
      } else {
        toast.error(
          data.activation?.message ?? 'Verificado, mas o registro não concluiu.',
          { duration: 12000 },
        );
      }
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('verify-code failed:', err);
      toast.error('Não foi possível confirmar o código.');
    } finally {
      setVerifyingCode(false);
    }
  }

  // Auto-reconciliação silenciosa ao abrir a página: números antigos
  // (conectados reaproveitando token / antes do rastreamento de registro)
  // mostram "Não registrado" mesmo estando CONNECTED e inscritos na Meta.
  // Uma verificação silenciosa no primeiro load em que o número está
  // conectado mas sem registered_at limpa o falso alarme em qualquer conta,
  // sem depender do clique no botão. Roda no máximo uma vez por montagem.
  const autoHealTriedRef = useRef(false);
  useEffect(() => {
    if (
      !autoHealTriedRef.current &&
      config &&
      !config.registered_at &&
      connectionStatus === 'connected'
    ) {
      autoHealTriedRef.current = true;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      void handleVerifyRegistration({ silent: true });
    }
    // handleVerifyRegistration é estável o suficiente; o ref evita reexecução.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, connectionStatus]);

  async function handleReset() {
    const multi = channels.length > 1;
    if (
      !confirm(
        multi
          ? 'Remover este canal? As conversas dele passam a usar o canal primário.'
          : 'Isso vai excluir a configuração atual do WhatsApp para você reinseri-la. Continuar?',
      )
    ) {
      return;
    }

    try {
      setResetting(true);
      const qs =
        mode === 'edit' && selectedChannelId
          ? `?channelId=${selectedChannelId}`
          : '';
      const res = await fetch(`/api/whatsapp/config${qs}`, { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Falha ao redefinir a configuração');
        return;
      }

      toast.success(multi ? 'Canal removido.' : 'Configuração limpa. Agora você pode reinserir suas credenciais.');
      selRef.current = null;
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Falha ao redefinir a configuração');
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('URL do webhook copiada para a área de transferência');
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="Conexão do WhatsApp"
          description="Conecte sua API do WhatsApp Business da Meta. Credenciais, webhook e etapas de configuração ficam todos aqui."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Conexão do WhatsApp"
        description="Conecte sua API do WhatsApp Business da Meta. Cada número é um canal — use vários para separar SDR, Onboarding, etc."
      />

      {/* Barra de canais (multi-canal) */}
      {channels.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Canais</span>
          {channels.map((ch) => {
            const active = mode === 'edit' && ch.id === selectedChannelId;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => selectChannel(ch.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {(ch as unknown as { label?: string }).label ||
                  ch.phone_number_id}
                {ch.is_primary && (
                  <span title="Canal primário" className="text-amber-400">
                    ★
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={startNewChannel}
            className={`inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs font-medium ${
              mode === 'new'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            + Adicionar canal
          </button>
          {mode === 'edit' &&
          selectedChannelId &&
          !channels.find((c) => c.id === selectedChannelId)?.is_primary ? (
            <button
              type="button"
              onClick={() => handleSetPrimary(selectedChannelId)}
              className="text-xs text-primary hover:underline"
            >
              Tornar primário
            </button>
          ) : null}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* Main config form */}
      <div className="space-y-6">
        {/* Corrupted-token reset banner */}
        {showResetBanner && (
          <Alert className="bg-amber-950/40 border-amber-600/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <AlertTitle className="text-amber-200 mb-1">
                  Não é possível descriptografar o token armazenado
                </AlertTitle>
                <AlertDescription className="text-amber-100/80 text-sm">
                  {statusMessage}
                </AlertDescription>
                <Button
                  onClick={handleReset}
                  disabled={resetting}
                  size="sm"
                  className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Redefinindo...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-4" />
                      Redefinir configuração
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Connection Status */}
        <Alert className="bg-card border-border">
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-foreground mb-0">
              {connectionStatus === 'connected' ? 'Credenciais válidas' : 'Não conectado'}
            </AlertTitle>
          </div>
          <AlertDescription className="text-muted-foreground">
            {connectionStatus === 'connected'
              ? 'Seu token de acesso autentica com a Meta. Veja o status de registro abaixo para saber se os webhooks estão realmente configurados.'
              : statusMessage ||
                'Configure suas credenciais da API da Meta abaixo para conectar sua conta do WhatsApp Business.'}
          </AlertDescription>
        </Alert>

        {/* Registration Status — the "is it actually live?" check.
            Credentials being valid is necessary but not sufficient;
            without a successful /register call the number won't
            receive inbound events. Surface this dimension separately
            so users don't trust a misleading green banner. */}
        {config && (
          <Alert
            className={
              isRegistered
                ? 'bg-emerald-950/30 border-emerald-700/50'
                : 'bg-amber-950/30 border-amber-700/50'
            }
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {isRegistered ? (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-400" />
                )}
                <AlertTitle
                  className={
                    'mb-0 ' + (isRegistered ? 'text-emerald-200' : 'text-amber-200')
                  }
                >
                  {isRegistered
                    ? 'Registrado — a Meta entregará eventos à Central de Receita'
                    : 'Não registrado — os envios falham (#133010) e a Meta não entrega eventos'}
                </AlertTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleVerifyRegistration()}
                disabled={verifyingRegistration}
                className="border-border bg-transparent text-foreground hover:bg-muted h-7"
              >
                {verifyingRegistration ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                Verificar com a Meta
              </Button>
            </div>
            <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {isRegistered ? (
                <>
                  Inscrito desde{' '}
                  {config.registered_at
                    ? new Date(config.registered_at).toLocaleString()
                    : 'desconhecido'}
                  . Clique em <strong>Verificar com a Meta</strong> se os
                  eventos pararem de chegar.
                </>
              ) : lastRegistrationError ? (
                <>
                  A última tentativa de registro falhou com:{' '}
                  <span className="text-red-300">
                    &quot;{lastRegistrationError}&quot;
                  </span>
                  . Enquanto não registrar, os envios falham com{' '}
                  <span className="text-red-300">
                    (#133010) Account not registered
                  </span>
                  . Insira (ou corrija) o PIN de verificação em duas etapas
                  abaixo e clique em Salvar configuração para tentar de novo.
                </>
              ) : (
                <>
                  O número está conectado, mas{' '}
                  <strong className="text-amber-200">
                    não foi registrado na Cloud API
                  </strong>{' '}
                  (o registro foi pulado por falta de PIN). Enquanto isso,{' '}
                  <strong className="text-amber-200">todo envio falha</strong>{' '}
                  com o erro{' '}
                  <span className="text-red-300">
                    (#133010) Account not registered
                  </span>
                  . Para resolver: informe o{' '}
                  <strong>PIN de verificação em duas etapas</strong> do número no
                  campo abaixo e clique em <strong>Salvar configuração</strong>{' '}
                  para registrá-lo. (Números de teste da Meta já vêm registrados —
                  não precisam de PIN.)
                </>
              )}
            </AlertDescription>

            {registrationProbe && (
              <div className="mt-3 rounded border border-border bg-card/60 px-3 py-2 space-y-1.5 text-[11px]">
                <p className="font-medium text-foreground">
                  Diagnóstico — última execução: {' '}
                  <span className={registrationProbe.live ? 'text-emerald-400' : 'text-amber-400'}>
                    {registrationProbe.live ? 'no ar' : 'fora do ar'}
                  </span>
                </p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {Object.entries(registrationProbe.checks).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-1.5">
                      {v === true ? (
                        <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                      ) : v === false ? (
                        <XCircle className="size-3 text-red-400 shrink-0" />
                      ) : (
                        <span className="size-3 rounded-full border border-border shrink-0" />
                      )}
                      <code className="text-muted-foreground">{k}</code>
                    </li>
                  ))}
                </ul>
                {(registrationProbe.errors ?? []).length > 0 && (
                  <ul className="pt-1 space-y-0.5 text-red-300">
                    {registrationProbe.errors?.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Alert>
        )}

        {/* CAMINHO B — re-verificação do número.
            Aparece quando a Meta reporta code_verification_status = EXPIRED.
            É o único passo do onboarding que a automação não resolve sozinha:
            o código chega no chip, então precisa de alguém com acesso à linha. */}
        {needsCodeVerification && (
          <Alert className="bg-amber-950/30 border-amber-700/50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-400" />
              <AlertTitle className="mb-0 text-amber-200">
                Verificação expirada — é preciso confirmar a posse da linha
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed space-y-3">
              <p>
                A Meta exige revalidar este número antes de reativá-lo. Ela vai
                enviar um código{' '}
                <strong className="text-amber-200">para o próprio número</strong>{' '}
                (SMS ou ligação). Alguém precisa ter acesso à linha agora — não
                existe forma de pular esta etapa pela API.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={codeMethod}
                  onChange={(e) =>
                    setCodeMethod(e.target.value === 'VOICE' ? 'VOICE' : 'SMS')
                  }
                  className="h-8 rounded border border-border bg-muted px-2 text-foreground text-xs"
                >
                  <option value="SMS">Receber por SMS</option>
                  <option value="VOICE">Receber por ligação</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRequestCode}
                  disabled={requestingCode}
                  className="border-border bg-transparent text-foreground hover:bg-muted h-8"
                >
                  {requestingCode ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Zap className="size-3.5" />
                  )}
                  {codeSent ? 'Reenviar código' : 'Enviar código'}
                </Button>
              </div>

              {codeSent && (
                <div className="flex flex-wrap items-end gap-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-[11px]">
                      Código recebido no número
                    </Label>
                    <Input
                      placeholder="ex.: 123456"
                      value={verificationCode}
                      onChange={(e) =>
                        setVerificationCode(
                          e.target.value.replace(/\D/g, '').slice(0, 8),
                        )
                      }
                      className="h-8 w-40 bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleVerifyCode}
                    disabled={verifyingCode}
                    className="h-8"
                  >
                    {verifyingCode ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    Confirmar e ativar
                  </Button>
                </div>
              )}
              <p className="text-[11px]">
                Depois de confirmar o código, o número é registrado
                automaticamente com o PIN de verificação em duas etapas. Se
                ainda não informou o PIN, preencha-o no campo abaixo antes de
                confirmar.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Diagnósticos que impedem o save: nada foi gravado, e a causa não é
            o número, é o token/BM ou um WABA com vários números. */}
        {activation?.outcome === 'wrong_token_or_bm' && (
          <Alert className="bg-red-950/30 border-red-700/50">
            <div className="flex items-center gap-2">
              <XCircle className="size-4 text-red-400" />
              <AlertTitle className="mb-0 text-red-200">
                O token não alcança esse número
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed space-y-2">
              <p>{activation.message}</p>
              {(activation.missingScopes ?? []).length > 0 && (
                <p>
                  Permissões faltando:{' '}
                  <code className="text-red-300">
                    {activation.missingScopes?.join(', ')}
                  </code>
                </p>
              )}
              {(activation.reachable ?? []).length > 0 && (
                <div>
                  <p className="font-medium text-foreground">
                    Este token administra:
                  </p>
                  <ul className="space-y-0.5">
                    {activation.reachable?.map((b) => (
                      <li key={b.businessId}>
                        • {b.businessName ?? b.businessId} — WABAs:{' '}
                        {b.wabaIds.length > 0 ? b.wabaIds.join(', ') : 'nenhum'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {activation?.outcome === 'ambiguous_waba' && (
          <Alert className="bg-amber-950/30 border-amber-700/50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-400" />
              <AlertTitle className="mb-0 text-amber-200">
                Escolha qual número ativar
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed space-y-2">
              <p>{activation.message}</p>
              <ul className="space-y-1">
                {activation.candidates?.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-border bg-transparent text-foreground hover:bg-muted"
                      onClick={() => {
                        setPhoneNumberId(c.id);
                        setActivation(null);
                        toast.info(
                          'Número selecionado. Clique em Salvar configuração para ativar.',
                        );
                      }}
                    >
                      Usar este
                    </Button>
                    <span>
                      {c.display_phone_number ?? c.id}
                      {c.verified_name ? ` — ${c.verified_name}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* API Credentials */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Credenciais da API</CardTitle>
            <CardDescription className="text-muted-foreground">
              Insira suas credenciais da API do WhatsApp Business da Meta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Nome do canal</Label>
              <Input
                placeholder="ex.: SDR, Onboarding, Suporte"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-[11px] text-muted-foreground">
                Só um rótulo pra você identificar este número no CRM.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">ID do número de telefone</Label>
              <Input
                placeholder="ex.: 100234567890123"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">ID da Conta do WhatsApp Business</Label>
              <Input
                placeholder="ex.: 100234567890456"
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Token de acesso permanente</Label>
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder="Insira seu token de acesso"
                  value={accessToken}
                  onChange={(e) => {
                    setAccessToken(e.target.value);
                    setTokenEdited(true);
                  }}
                  onFocus={() => {
                    if (accessToken === MASKED_TOKEN) {
                      setAccessToken('');
                      setTokenEdited(true);
                    }
                  }}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {config && !tokenEdited && (
                <p className="text-xs text-muted-foreground">
                  O token está oculto por segurança. Reinsira-o para atualizar a configuração.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Token de verificação do webhook</Label>
              <Input
                placeholder="Crie um token de verificação personalizado"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Uma sequência personalizada que você cria. Deve corresponder ao token definido nas configurações de webhook da Meta.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">
                App Secret do App Meta
                <span className="ml-1 text-muted-foreground">(recomendado)</span>
              </Label>
              <Input
                type="password"
                placeholder="App Secret — Meta → Configurações do app → Básico"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Valida a assinatura dos webhooks da Meta{' '}
                <strong className="text-muted-foreground">deste canal</strong>.
                Preenchendo aqui, o número passa a receber mensagens sem depender
                de variável de ambiente no servidor (nem de deploy). Fica
                criptografado. Deixe em branco para manter o segredo já salvo.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">
                PIN de verificação em duas etapas
                <span className="ml-1 text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="PIN de 6 dígitos do Gerenciador do WhatsApp da Meta"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground tracking-widest"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                É o PIN de 6 dígitos que ativa o número na Cloud API. Defina-o
                em{' '}
                <strong className="text-muted-foreground">
                  Meta Business Manager → Contas do WhatsApp → Números de
                  telefone → Verificação em duas etapas
                </strong>{' '}
                e cole aqui.{' '}
                <strong className="text-muted-foreground">
                  Se este número já teve um PIN antes, use o PIN antigo
                </strong>{' '}
                — a Meta não aceita definir um novo, e sem ele o reset leva 7
                dias ou depende do suporte. O PIN fica salvo criptografado e é
                reutilizado nas próximas reconexões, então você só precisa
                informá-lo uma vez. Deixe em branco para manter o já salvo.{' '}
                <strong className="text-muted-foreground">
                  Números de teste da Meta
                </strong>{' '}
                não têm PIN — para eles, o número já vem conectado e nada é
                pedido.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Webhook URL */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Configuração do webhook</CardTitle>
            <CardDescription className="text-muted-foreground">
              Use esta URL como callback do webhook no Painel de Aplicativos da Meta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label className="text-muted-foreground">URL de callback do webhook</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookUrl}
                  className="bg-muted border-border text-muted-foreground font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar configuração'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !config}
            className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {testing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Testando...
              </>
            ) : (
              <>
                <Zap className="size-4" />
                Testar conexão com a API
              </>
            )}
          </Button>
          {config && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={resetting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
            >
              {resetting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Redefinindo...
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  Redefinir configuração
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Setup Instructions Sidebar */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">Instruções de configuração</CardTitle>
            <CardDescription className="text-muted-foreground">
              Siga estas etapas para conectar sua API do WhatsApp Business.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion>
              <AccordionItem className="border-border">
                <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                    Crie um aplicativo na Meta
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Acesse <span className="text-primary">developers.facebook.com</span></li>
                    <li>Clique em &quot;My Apps&quot; e depois em &quot;Create App&quot;</li>
                    <li>Selecione &quot;Business&quot; como o tipo de aplicativo</li>
                    <li>Preencha os detalhes do aplicativo e crie</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-border">
                <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                    Adicione o produto WhatsApp
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>No painel do seu aplicativo, clique em &quot;Add Product&quot;</li>
                    <li>Encontre &quot;WhatsApp&quot; e clique em &quot;Set Up&quot;</li>
                    <li>Siga o assistente de configuração para vincular seu negócio</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-border">
                <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                    Obtenha as credenciais da API
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Vá em WhatsApp &gt; API Setup</li>
                    <li>Copie seu <strong className="text-foreground">ID do número de telefone</strong></li>
                    <li>Copie seu <strong className="text-foreground">ID da Conta do WhatsApp Business</strong></li>
                    <li>Gere um <strong className="text-foreground">Token de acesso permanente</strong> em Business Settings &gt; System Users</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-border">
                <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                    Configure os webhooks
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Vá em WhatsApp &gt; Configuration</li>
                    <li>Clique em &quot;Edit&quot; na seção Webhook</li>
                    <li>Cole a <strong className="text-foreground">URL de callback do webhook</strong> de cima</li>
                    <li>Insira o mesmo <strong className="text-foreground">Token de verificação</strong> que você definiu aqui</li>
                    <li>Inscreva-se no campo de webhook &quot;messages&quot;</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-4 pt-4 border-t border-border">
              <a
                href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                Documentação da API do WhatsApp da Meta
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </section>
  );
}
