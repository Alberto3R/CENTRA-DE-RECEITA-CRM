"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { funcaoInfo } from "@/lib/pipelines/funcoes";
import {
  importarCompartilhamento,
  lerCompartilhamento,
  type EtapaCompartilhada,
} from "@/lib/pipelines/compartilhar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Abre quando alguém chega em /pipelines?importar=<token>. Mostra as etapas
// do funil compartilhado e cria uma cópia na conta de quem está logado.
export function ImportarFunilDialog({
  token,
  accountId,
  onClose,
  onImported,
}: {
  token: string;
  accountId: string | null;
  onClose: () => void;
  onImported: (pipelineId: string) => void;
}) {
  const supabase = createClient();
  const [carregando, setCarregando] = useState(true);
  const [etapas, setEtapas] = useState<EtapaCompartilhada[]>([]);
  const [nome, setNome] = useState("");
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    lerCompartilhamento(supabase, token).then((r) => {
      if (cancelado) return;
      if (r) {
        setEtapas(r.etapas);
        setNome(r.nome);
      }
      setCarregando(false);
    });
    return () => {
      cancelado = true;
    };
  }, [supabase, token]);

  async function importar() {
    if (!accountId) {
      toast.error("Seu perfil não está vinculado a uma conta.");
      return;
    }
    setImportando(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Sessão expirada. Entre de novo.");
      const id = await importarCompartilhamento({
        supabase,
        accountId,
        userId: session.user.id,
        token,
        nome: nome.trim() || "Funil importado",
        etapas,
      });
      toast.success("Funil importado");
      onImported(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar");
    } finally {
      setImportando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Importar funil compartilhado</DialogTitle>
        </DialogHeader>

        {carregando ? (
          <p className="py-6 text-sm text-muted-foreground">Carregando…</p>
        ) : etapas.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            Este link não existe ou não tem etapas para importar.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Nome do funil</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="mt-2 border-border bg-muted text-foreground"
              />
            </div>
            <ol className="space-y-1.5">
              {etapas.map((e, i) => {
                const f = funcaoInfo(e.funcao);
                return (
                  <li key={`${i}-${e.nome}`} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 text-foreground">{e.nome}</span>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${f.cor}22`, color: f.cor }}
                    >
                      {f.label}
                    </span>
                    <span className="w-24 text-right text-[11px] text-muted-foreground">
                      {e.dias_max ? `até ${e.dias_max}d` : "sem prazo"} · {e.toques.length} contato(s)
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="text-xs text-muted-foreground">
              Vira um funil novo na sua conta. Nada do funil de origem — negócios, contatos — vem junto.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="border-border text-muted-foreground">
            Cancelar
          </Button>
          <Button
            onClick={importar}
            disabled={importando || carregando || etapas.length === 0}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {importando ? "Importando..." : "Importar funil"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
