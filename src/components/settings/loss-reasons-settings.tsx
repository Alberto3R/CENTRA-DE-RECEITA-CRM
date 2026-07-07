"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Shield, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_LOSS_REASONS } from "@/lib/deals/loss-reasons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsChip } from "./settings-chip";

interface Reason {
  id: string;
  reason: string;
  position: number;
}

/**
 * Settings → Motivos de perda. A lista que aparece ao marcar um negócio como
 * perdido, editável por conta. Admin-gated (RLS reforça). Se a conta não tiver
 * nenhum, o deal-form cai na lista padrão do sistema.
 */
export function LossReasonsSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [reasons, setReasons] = useState<Reason[]>([]);
  const [loading, setLoading] = useState(true);
  const [novo, setNovo] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchReasons = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from("loss_reasons")
      .select("*")
      .eq("account_id", accountId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    setReasons((data as Reason[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) fetchReasons();
  }, [accountId, fetchReasons]);

  async function adicionar() {
    const r = novo.trim();
    if (!r || !accountId) return;
    if (reasons.some((x) => x.reason.toLowerCase() === r.toLowerCase())) {
      toast.error("Esse motivo já existe.");
      return;
    }
    setCreating(true);
    const { error } = await supabase
      .from("loss_reasons")
      .insert({ account_id: accountId, reason: r, position: reasons.length });
    setCreating(false);
    if (error) {
      toast.error("Não foi possível adicionar (talvez sem permissão).");
      return;
    }
    setNovo("");
    await fetchReasons();
  }

  async function renomear(x: Reason, nome: string): Promise<boolean> {
    const r = nome.trim();
    if (!r || r === x.reason) return true;
    setBusyId(x.id);
    const { error } = await supabase
      .from("loss_reasons")
      .update({ reason: r })
      .eq("id", x.id);
    setBusyId(null);
    if (error) {
      toast.error("Não foi possível renomear.");
      return false;
    }
    await fetchReasons();
    return true;
  }

  async function excluir(x: Reason) {
    if (!window.confirm(`Excluir o motivo "${x.reason}"?`)) return;
    setBusyId(x.id);
    const { error } = await supabase.from("loss_reasons").delete().eq("id", x.id);
    setBusyId(null);
    if (error) {
      toast.error("Não foi possível excluir.");
      return;
    }
    await fetchReasons();
  }

  async function usarPadrao() {
    if (!accountId) return;
    setCreating(true);
    const rows = DEFAULT_LOSS_REASONS.map((reason, i) => ({
      account_id: accountId,
      reason,
      position: i,
    }));
    const { error } = await supabase.from("loss_reasons").insert(rows);
    setCreating(false);
    if (error) {
      toast.error("Não foi possível aplicar a lista padrão.");
      return;
    }
    toast.success("Lista padrão aplicada — agora é só editar.");
    await fetchReasons();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          Motivos de perda
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            Administrador
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          A lista que aparece ao marcar um negócio como perdido. Alimenta a
          análise de motivos de perda nos Relatórios e no Gestor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEditSettings ? (
          <div className="flex items-center gap-2">
            <Input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void adicionar();
                }
              }}
              placeholder="Novo motivo de perda…"
              className="bg-muted text-foreground"
            />
            <Button
              onClick={adicionar}
              disabled={creating || !novo.trim()}
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Adicionar
            </Button>
          </div>
        ) : null}

        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando…
            </div>
          ) : reasons.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
              <span>
                Sua conta ainda usa a lista padrão do sistema (8 motivos).
              </span>
              {canEditSettings ? (
                <Button
                  variant="outline"
                  onClick={usarPadrao}
                  disabled={creating}
                >
                  Começar com a lista padrão
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {reasons.map((x) => (
                <ReasonRow
                  key={x.id}
                  reason={x}
                  busy={busyId === x.id}
                  editable={canEditSettings}
                  onRename={renomear}
                  onDelete={excluir}
                />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ReasonRow({
  reason,
  busy,
  editable,
  onRename,
  onDelete,
}: {
  reason: Reason;
  busy: boolean;
  editable: boolean;
  onRename: (r: Reason, nome: string) => Promise<boolean>;
  onDelete: (r: Reason) => void;
}) {
  const [nome, setNome] = useState(reason.reason);

  async function commit() {
    if (nome.trim() === reason.reason) {
      setNome(reason.reason);
      return;
    }
    const ok = await onRename(reason, nome);
    if (!ok) setNome(reason.reason);
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <Input
        value={nome}
        disabled={busy || !editable}
        onChange={(e) => setNome(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 border-transparent bg-transparent text-foreground hover:border-border focus:border-primary"
      />
      {editable ? (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => onDelete(reason)}
          title="Excluir motivo"
          className="shrink-0 text-muted-foreground hover:text-red-400"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      ) : null}
    </li>
  );
}
