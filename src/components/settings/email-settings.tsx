'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Mail, CheckCircle2, AlertCircle, Loader2, Send, Inbox } from 'lucide-react';

interface CanalEmail {
  id: string;
  label: string | null;
  status: string;
  email_address: string;
  email_provider: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  imap_host: string | null;
  imap_port: number | null;
  daily_send_limit: number | null;
  last_poll_at: string | null;
  connected_at: string | null;
}

interface Veredicto {
  ok: boolean;
  detalhe?: string;
}
interface ResultadoTeste {
  envio: Veredicto;
  recebimento: Veredicto;
  pronto: boolean;
}

/**
 * Configuração do canal de e-mail.
 *
 * Diferente do painel do Instagram (que é read-only e lê direto do Supabase),
 * aqui tudo passa por `/api/email/config`: a senha de app precisa ser cifrada
 * no servidor e nunca pode voltar para o cliente.
 *
 * O teste de conexão separa ENVIO de RECEBIMENTO de propósito. No Zoho o SMTP
 * autentica normalmente enquanto o IMAP pode estar desligado por configuração —
 * um resultado único diria só "falhou" e mandaria o operador procurar a senha
 * errada, quando o que falta é uma opção no painel do provedor.
 */
export function EmailSettings() {
  const { accountId } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [canais, setCanais] = useState<CanalEmail[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Record<string, ResultadoTeste>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // formulário
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [endereco, setEndereco] = useState('');
  const [provedor, setProvedor] = useState('zoho');
  const [senha, setSenha] = useState('');
  const [teto, setTeto] = useState(50);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch('/api/email/config');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Falha ao carregar');
      setCanais(j.canais ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (accountId) carregar();
  }, [accountId, carregar]);

  function limparFormulario() {
    setEditandoId(null);
    setLabel('');
    setEndereco('');
    setProvedor('zoho');
    setSenha('');
    setTeto(50);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editandoId,
          label,
          emailAddress: endereco,
          provider: provedor,
          senha: senha || undefined,
          dailySendLimit: teto,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Falha ao salvar');
      setAviso('Canal salvo.');
      limparFormulario();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  async function testar(id: string) {
    setTestando(id);
    setErro(null);
    try {
      const r = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Falha no teste');
      setResultados((v) => ({ ...v, [id]: j }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha no teste');
    } finally {
      setTestando(null);
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando canais…
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Mail className="h-5 w-5" /> Canal de e-mail
        </h2>
        <p className="text-sm text-muted-foreground">
          Conecta uma caixa para prospecção. As respostas caem na sua caixa de conversas,
          junto do WhatsApp e do Instagram.
        </p>
      </header>

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{erro}</span>
        </div>
      )}
      {aviso && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <span>{aviso}</span>
        </div>
      )}

      {/* ── Canais conectados ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Caixas conectadas</h3>
        {canais.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma caixa conectada ainda.</p>
        )}
        {canais.map((c) => {
          const r = resultados[c.id];
          return (
            <div key={c.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{c.label ?? 'E-mail'}</p>
                  <p className="text-sm text-muted-foreground">{c.email_address}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.email_provider} · SMTP {c.smtp_host}:{c.smtp_port} · IMAP {c.imap_host}:
                    {c.imap_port} · teto {c.daily_send_limit}/dia
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => testar(c.id)}
                    disabled={testando === c.id}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    {testando === c.id ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Testando…
                      </span>
                    ) : (
                      'Testar conexão'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditandoId(c.id);
                      setLabel(c.label ?? '');
                      setEndereco(c.email_address);
                      setProvedor(c.email_provider ?? 'zoho');
                      setTeto(c.daily_send_limit ?? 50);
                      setSenha('');
                    }}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    Editar
                  </button>
                </div>
              </div>

              {r && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Veredito
                    icone={<Send className="h-4 w-4" />}
                    titulo="Envio (SMTP)"
                    v={r.envio}
                  />
                  <Veredito
                    icone={<Inbox className="h-4 w-4" />}
                    titulo="Recebimento (IMAP)"
                    v={r.recebimento}
                  />
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ── Formulário ────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-4">
        <h3 className="text-sm font-medium">
          {editandoId ? 'Editar caixa' : 'Conectar uma caixa'}
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Nome do canal">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="E-mail · Prospecção"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </Campo>

          <Campo label="Endereço">
            <input
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="voce@seudominio.com.br"
              disabled={!!editandoId}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
          </Campo>

          <Campo label="Provedor">
            <select
              value={provedor}
              onChange={(e) => setProvedor(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="zoho">Zoho</option>
              <option value="google">Google Workspace</option>
            </select>
          </Campo>

          <Campo label="Limite diário de envios">
            <input
              type="number"
              min={1}
              max={500}
              value={teto}
              onChange={(e) => setTeto(Number(e.target.value))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </Campo>

          <Campo
            label={editandoId ? 'Senha de app (deixe vazio para manter)' : 'Senha de app'}
            dica="Gerada no painel do provedor. Fica cifrada — nunca é exibida de volta."
          >
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </Campo>
        </div>

        <p className="text-xs text-muted-foreground">
          Host e porta são preenchidos automaticamente pelo provedor escolhido.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || !endereco}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Conectar'}
          </button>
          {editandoId && (
            <button
              type="button"
              onClick={limparFormulario}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Cancelar
            </button>
          )}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Prospecção por e-mail exige SPF, DKIM e DMARC no domínio de envio, e uma caixa
        aquecida. Volume acima da capacidade não devolve erro — degrada a entrega em silêncio.
      </p>
    </div>
  );
}

function Campo({
  label,
  dica,
  children,
}: {
  label: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {dica && <span className="block text-xs text-muted-foreground">{dica}</span>}
    </label>
  );
}

function Veredito({
  icone,
  titulo,
  v,
}: {
  icone: React.ReactNode;
  titulo: string;
  v: Veredicto;
}) {
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        v.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'
      }`}
    >
      <p className="flex items-center gap-1.5 font-medium">
        {icone}
        {titulo}
        {v.ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <AlertCircle className="h-4 w-4 text-amber-500" />
        )}
      </p>
      {v.detalhe && <p className="mt-1 text-xs text-muted-foreground">{v.detalhe}</p>}
    </div>
  );
}
