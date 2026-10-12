'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Loader2, MessagesSquare, Power } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { newLinkCode } from '@/lib/grupos/text';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Agente no grupo (migration 116): o Assistente 3R participa do grupo de
 * WhatsApp com o cliente e, quando marcado, cria funil, etapa, tag ou template
 * — sempre mostrando o plano e esperando o "ok" de quem pediu.
 *
 * Aqui o admin gera o código que liga um grupo a ESTA conta, vê os grupos
 * ligados e o histórico de pedidos.
 */

interface Group {
  id: string;
  name: string | null;
  linked_at: string | null;
  active: boolean;
}

interface Req {
  id: string;
  requester_name: string | null;
  request_text: string;
  status: string;
  summary: string | null;
  created_at: string;
}

const STATUS: Record<string, string> = {
  awaiting_confirmation: 'aguardando ok',
  executing: 'executando',
  done: 'feito',
  failed: 'feito em parte',
  cancelled: 'cancelado',
  expired: 'expirado',
  answered: 'respondido',
  not_linked: 'grupo sem conta',
  error: 'erro',
};

export function GroupAgentSettings() {
  const supabase = useMemo(() => createClient(), []);
  const { accountId, canEditSettings } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(
    null
  );
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [g, r, c] = await Promise.all([
      supabase
        .from('whatsapp_groups')
        .select('id, name, linked_at, active')
        .eq('account_id', accountId)
        .order('linked_at', { ascending: false }),
      supabase
        .from('group_agent_requests')
        .select('id, requester_name, request_text, status, summary, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('group_link_codes')
        .select('code, expires_at')
        .eq('account_id', accountId)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setGroups((g.data as Group[]) ?? []);
    setReqs((r.data as Req[]) ?? []);
    setCode((c.data as { code: string; expires_at: string } | null) ?? null);
    setLoaded(true);
  }, [accountId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial (padrão do repo)
    load();
  }, [load]);

  async function gerar() {
    if (!accountId) return;
    setBusy(true);
    const novo = newLinkCode();
    const { data, error } = await supabase
      .from('group_link_codes')
      .insert({ code: novo, account_id: accountId })
      .select('code, expires_at')
      .single();
    setBusy(false);
    if (error || !data) return toast.error('Falha ao gerar o código');
    setCode(data as { code: string; expires_at: string });
  }

  async function copiar() {
    if (!code) return;
    await navigator.clipboard.writeText(`@Assistente ${code.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function alternar(g: Group) {
    const { error } = await supabase
      .from('whatsapp_groups')
      .update({ active: !g.active })
      .eq('id', g.id);
    if (error) return toast.error('Falha ao atualizar o grupo');
    setGroups((gs) =>
      gs.map((x) => (x.id === g.id ? { ...x, active: !g.active } : x))
    );
  }

  if (!loaded) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-200">
      <SettingsPanelHead
        title="Agente no grupo"
        description="O Assistente 3R no grupo de WhatsApp com o cliente: marcado, ele cria funil, etapa, tag ou template, sempre mostrando o plano e esperando o ok de quem pediu."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <MessagesSquare className="text-primary size-4" /> Ligar um grupo a
            esta conta
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            1. Adicione o número do Assistente 3R ao grupo. 2. Gere o código
            abaixo. 3. Mande no grupo marcando o assistente. A partir daí, tudo
            o que for pedido naquele grupo acontece nesta conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {code ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="border-border bg-muted text-foreground rounded-lg border px-3 py-2 font-mono text-sm">
                @Assistente {code.code}
              </code>
              <Button variant="outline" size="sm" onClick={copiar}>
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
              <span className="text-muted-foreground text-xs">
                vale até {new Date(code.expires_at).toLocaleString('pt-BR')},
                uso único
              </span>
            </div>
          ) : (
            canEditSettings && (
              <Button variant="outline" onClick={gerar} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Gerar código'
                )}
              </Button>
            )
          )}

          <div className="pt-2">
            <div className="text-foreground mb-1 text-sm font-medium">
              Grupos ligados
            </div>
            {groups.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhum grupo ligado ainda.
              </p>
            ) : (
              <div className="divide-border border-border divide-y rounded-lg border">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-foreground min-w-0 flex-1 truncate">
                      {g.name || 'Grupo sem nome'}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {g.active ? 'ativo' : 'desligado'}
                    </span>
                    {canEditSettings && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => alternar(g)}
                        aria-label={g.active ? 'Desligar' : 'Religar'}
                      >
                        <Power className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-foreground">Últimos pedidos</CardTitle>
          <CardDescription className="text-muted-foreground">
            O que foi pedido ao assistente nos grupos desta conta e o que
            aconteceu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reqs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum pedido ainda.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {reqs.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground min-w-0 truncate">
                      <strong>{r.requester_name ?? 'Alguém'}:</strong>{' '}
                      {r.request_text}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {STATUS[r.status] ?? r.status} ·{' '}
                      {new Date(r.created_at).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  {r.summary && (
                    <div className="text-muted-foreground text-xs">
                      {r.summary}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
