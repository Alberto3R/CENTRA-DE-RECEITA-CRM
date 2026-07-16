'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { InstagramGlyph } from '@/components/inbox/channel-display';
import { CheckCircle2, AlertCircle, MessageCircle, Bot, Clock } from 'lucide-react';

interface IgChannel {
  id: string;
  label: string | null;
  status: string;
  ig_user_id: string | null;
  ig_page_id: string | null;
  connected_at: string | null;
}

/**
 * Seção de Configurações do canal Instagram Direct — separada do WhatsApp
 * (que tem número/WABA/PIN, coisas que não existem no IG). MVP informativo:
 * mostra a conta conectada, status e como as DMs fluem. A conexão hoje é
 * provisionada no banco (Fase 1); a tela é read-only.
 */
export function InstagramSettings() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<IgChannel[]>([]);

  const load = useCallback(
    async (acctId: string) => {
      setLoading(true);
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('id,label,status,ig_user_id,ig_page_id,connected_at')
        .eq('account_id', acctId)
        .eq('channel_type', 'instagram')
        .order('created_at', { ascending: true });
      if (error) console.error('Falha ao carregar canais Instagram:', error);
      setChannels((data ?? []) as IgChannel[]);
      setLoading(false);
    },
    [supabase],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accountId) load(accountId);
  }, [accountId, load]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <span className="text-[#E1306C]">
            <InstagramGlyph className="h-5 w-5" />
          </span>
          Instagram Direct
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Receba e responda as DMs do seu Instagram dentro do CRM, ao lado do
          WhatsApp.
        </p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : channels.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            Nenhuma conta do Instagram conectada nesta conta ainda.
          </div>
        </div>
      ) : (
        channels.map((ch) => {
          const connected = ch.status === 'connected';
          return (
            <div key={ch.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-[#E1306C]">
                    <InstagramGlyph className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {ch.label || 'Instagram'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Conta comercial conectada via Página do Facebook
                    </div>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    connected
                      ? 'bg-primary/10 text-primary'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {connected ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <AlertCircle className="h-3 w-3" />
                  )}
                  {connected ? 'Conectado' : 'Desconectado'}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-border pt-4 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">IG user id</dt>
                  <dd className="truncate font-mono text-foreground">{ch.ig_user_id || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Page id</dt>
                  <dd className="truncate font-mono text-foreground">{ch.ig_page_id || '—'}</dd>
                </div>
              </dl>
            </div>
          );
        })
      )}

      {/* Como funciona */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">Como funciona</h3>
        <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              As DMs recebidas aparecem em <strong className="text-foreground">Conversas</strong>,
              com o <span className="text-[#E1306C]">@usuário</span> no lugar do telefone.
            </span>
          </li>
          <li className="flex gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              Você pode responder em texto livre dentro da{' '}
              <strong className="text-foreground">janela de 24h</strong> após a última
              mensagem do cliente (regra da Meta).
            </span>
          </li>
          <li className="flex gap-3">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              Automações e fluxos já respondem no Instagram. Para o{' '}
              <strong className="text-foreground">agente de IA</strong> responder as DMs,
              configure um agente para este canal em{' '}
              <strong className="text-foreground">Agente IA</strong>.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
