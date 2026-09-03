"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, GitBranch } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { bulkCreateDeals } from "@/lib/deals/bulk-create";
import { PipelineStagePicker } from "@/components/pipelines/pipeline-stage-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface BulkCreateDealsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contatos selecionados na tela de Contatos. */
  contactIds: string[];
  /** Chamado depois de criar, para a tela limpar a seleção. */
  onCreated: () => void;
}

/**
 * "Criar negócios" para os contatos selecionados.
 *
 * Escolhe funil, etapa, responsável e valor uma vez e aplica na leva
 * inteira. Por padrão não duplica: contato que já está no funil escolhido
 * é pulado (dá para desligar, para quem quer mesmo um segundo negócio do
 * mesmo contato).
 */
export function BulkCreateDealsModal({
  open,
  onOpenChange,
  contactIds,
  onCreated,
}: BulkCreateDealsModalProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [valor, setValor] = useState("");
  const [prefixo, setPrefixo] = useState("");
  const [pularExistentes, setPularExistentes] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [membros, setMembros] = useState<
    { id: string; full_name: string | null }[]
  >([]);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelado = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("account_id", accountId);
      if (!cancelado)
        setMembros((data as { id: string; full_name: string | null }[]) ?? []);
    })();
    return () => {
      cancelado = true;
    };
  }, [open, accountId, supabase]);

  const total = contactIds.length;

  async function handleCriar() {
    if (!pipelineId || !stageId) {
      toast.error("Escolha o funil e a etapa de destino");
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error("Sessão expirada. Entre novamente.");
      return;
    }

    setSalvando(true);
    try {
      const { created, skipped, failed } = await bulkCreateDeals(supabase, {
        contactIds,
        pipelineId,
        stageId,
        accountId,
        userId: user.id,
        assignedTo: assignedTo || null,
        value: parseFloat(valor.replace(",", ".")) || 0,
        titlePrefix: prefixo,
        skipExisting: pularExistentes,
      });

      if (created > 0) {
        toast.success(
          `${created} negócio${created === 1 ? "" : "s"} criado${created === 1 ? "" : "s"}`,
        );
      }
      if (skipped > 0) {
        toast.info(
          `${skipped} contato${skipped === 1 ? "" : "s"} já ${skipped === 1 ? "estava" : "estavam"} no funil`,
        );
      }
      if (failed > 0) {
        toast.error(
          `Falha ao criar ${failed} negócio${failed === 1 ? "" : "s"}`,
        );
      }
      if (created === 0 && skipped === 0 && failed === 0) {
        toast.info("Nenhum negócio criado");
      }

      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao criar os negócios",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-4 text-primary" />
            Criar negócios em massa
          </DialogTitle>
          <DialogDescription>
            Um negócio para cada um dos{" "}
            <span className="font-medium text-foreground">{total}</span>{" "}
            contato{total === 1 ? "" : "s"} selecionado{total === 1 ? "" : "s"}.
            O título de cada negócio sai do nome do contato.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <PipelineStagePicker
            pipelineId={pipelineId}
            stageId={stageId}
            disabled={salvando}
            onChange={(next) => {
              setPipelineId(next.pipelineId);
              setStageId(next.stageId);
            }}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Responsável (opcional)
              </Label>
              <select
                value={assignedTo}
                disabled={salvando}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary disabled:opacity-60"
              >
                <option value="">Sem responsável</option>
                {membros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name || "Sem nome"}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Valor de cada negócio (opcional)
              </Label>
              <Input
                value={valor}
                disabled={salvando}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="h-9 bg-card"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Prefixo do título (opcional)
            </Label>
            <Input
              value={prefixo}
              disabled={salvando}
              onChange={(e) => setPrefixo(e.target.value)}
              placeholder="Ex.: Lista Setembro"
              className="h-9 bg-card"
            />
            <p className="text-[11px] text-muted-foreground">
              {prefixo.trim()
                ? `Fica assim: "${prefixo.trim()} — Maria Silva"`
                : 'Sem prefixo o título é só o nome do contato: "Maria Silva"'}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              checked={pularExistentes}
              disabled={salvando}
              onCheckedChange={(v) => setPularExistentes(v === true)}
              aria-label="Não duplicar contatos que já estão no funil"
            />
            <span className="text-sm text-foreground">
              Não duplicar
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Pula quem já tem negócio neste funil.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={salvando}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleCriar}
            disabled={salvando || !pipelineId || !stageId || total === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {salvando && <Loader2 className="size-4 animate-spin" />}
            Criar {total} negócio{total === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
