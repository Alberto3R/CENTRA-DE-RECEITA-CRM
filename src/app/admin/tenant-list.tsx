"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Eye, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Uma linha de `platform_tenant_overview()`. */
export interface TenantRow {
  account_id: string;
  account_name: string;
  created_at: string;
  member_count: number;
  contact_count: number;
  conversation_count: number;
  unread_total: number;
  channel_count: number;
  connected_channels: number;
  last_message_at: string | null;
}

const MIN_REASON_LENGTH = 10;

function relativeOrNever(iso: string | null): string {
  if (!iso) return "nunca";
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
}

export function TenantList({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<TenantRow | null>(null);
  const [reason, setReason] = useState("");
  const [entering, setEntering] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((t) => t.account_name.toLowerCase().includes(q));
  }, [tenants, query]);

  async function handleEnter() {
    if (!target) return;
    if (reason.trim().length < MIN_REASON_LENGTH) {
      toast.error(
        `Descreva o motivo com pelo menos ${MIN_REASON_LENGTH} caracteres.`,
      );
      return;
    }
    try {
      setEntering(true);
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: target.account_id,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Não foi possível abrir a sessão.");
        return;
      }
      setTarget(null);
      setReason("");
      // O inbox é onde o suporte quase sempre precisa olhar primeiro.
      router.push("/inbox");
      router.refresh();
    } catch {
      toast.error("Não foi possível abrir a sessão.");
    } finally {
      setEntering(false);
    }
  }

  return (
    <>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar conta…"
          className="border-border bg-muted pl-9 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma conta encontrada.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Conta</th>
                <th className="px-3 py-2.5 text-right font-medium">Canais</th>
                <th className="px-3 py-2.5 text-right font-medium">Membros</th>
                <th className="px-3 py-2.5 text-right font-medium">Contatos</th>
                <th className="px-3 py-2.5 text-right font-medium">Conversas</th>
                <th className="px-3 py-2.5 text-right font-medium">Não lidas</th>
                <th className="px-3 py-2.5 text-left font-medium">
                  Última mensagem
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((t) => {
                // Canal cadastrado mas nenhum conectado é o sintoma de
                // onboarding parado no meio — merece destaque, é a razão
                // mais comum de alguém abrir esta tela.
                const stalled = t.channel_count > 0 && t.connected_channels === 0;
                return (
                  <tr key={t.account_id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">
                        {t.account_name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        criada {relativeOrNever(t.created_at)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {t.channel_count === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={
                            stalled ? "text-amber-500" : "text-emerald-500"
                          }
                          title={
                            stalled
                              ? "Canal cadastrado mas nenhum conectado"
                              : "Canais conectados"
                          }
                        >
                          {t.connected_channels}/{t.channel_count}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {t.member_count}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {t.contact_count}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {t.conversation_count}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {t.unread_total || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {relativeOrNever(t.last_message_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setTarget(t);
                          setReason("");
                        }}
                      >
                        <Eye className="size-3.5" />
                        Entrar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Entrar na conta {target?.account_name}</DialogTitle>
            <DialogDescription>
              Você verá os dados desta conta em modo somente leitura por 30
              minutos. Nenhuma alteração é possível — o banco recusa escrita
              durante a sessão.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="impersonation-reason" className="text-muted-foreground">
              Motivo
            </Label>
            <Input
              id="impersonation-reason"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ex.: chamado #482 — cliente não recebe mensagens"
              className="border-border bg-muted text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Fica gravado em log permanente, junto com quem entrou e quando.
              Não pode ser editado nem apagado depois.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleEnter}
              disabled={entering || reason.trim().length < MIN_REASON_LENGTH}
            >
              {entering ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Eye className="size-4" />
              )}
              Entrar em modo leitura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
