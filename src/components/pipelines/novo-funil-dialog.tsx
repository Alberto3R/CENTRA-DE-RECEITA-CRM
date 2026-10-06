"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { funcaoInfo } from "@/lib/pipelines/funcoes";
import {
  CATEGORIAS,
  MODELOS,
  MODELO_PADRAO_ID,
  diasDaEtapa,
  toquesDaEtapa,
  type CategoriaModelo,
} from "@/lib/pipelines/modelos";
import { aplicarModelo } from "@/lib/pipelines/aplicar-modelo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// "Novo funil" a partir da biblioteca de modelos. Esquerda: modelos por
// segmento. Direita: prévia do escolhido — etapas com a função e o critério
// de avanço, motivos de perda e campos que entram na conta.
export function NovoFunilDialog({
  open,
  onOpenChange,
  accountId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  onCreated: (pipelineId: string) => void;
}) {
  const supabase = createClient();
  const [categoria, setCategoria] = useState<CategoriaModelo | "Todos">("Todos");
  const [modeloId, setModeloId] = useState(MODELO_PADRAO_ID);
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);

  const lista = useMemo(
    () => (categoria === "Todos" ? MODELOS : MODELOS.filter((m) => m.categoria === categoria)),
    [categoria],
  );
  const modelo = MODELOS.find((m) => m.id === modeloId) ?? MODELOS[0];

  function escolher(id: string) {
    setModeloId(id);
    setNome("");
  }

  async function criar() {
    if (!accountId) {
      toast.error("Seu perfil não está vinculado a uma conta.");
      return;
    }
    setCriando(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Sessão expirada. Entre de novo.");
      const r = await aplicarModelo({
        supabase,
        accountId,
        userId: session.user.id,
        modelo,
        nomeFunil: nome || modelo.nome,
      });
      const extras = [
        r.motivosNovos ? `${r.motivosNovos} motivo(s) de perda` : "",
        r.camposNovos ? `${r.camposNovos} campo(s)` : "",
      ].filter(Boolean);
      toast.success(
        extras.length ? `Funil criado · entraram ${extras.join(" e ")}` : "Funil criado",
      );
      onOpenChange(false);
      onCreated(r.pipelineId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar funil");
    } finally {
      setCriando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden border-border bg-popover p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-popover-foreground">Novo funil</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Escolha o modelo do seu segmento. Os nomes das etapas mudam; a função de cada uma é a
            mesma, por isso o painel mede qualquer modelo do mesmo jeito.
          </p>
        </DialogHeader>

        <div className="grid max-h-[calc(90vh-140px)] grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:overflow-hidden">
          {/* Biblioteca */}
          <div className="border-b border-border p-4 md:overflow-y-auto md:border-b-0 md:border-r">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(["Todos", ...CATEGORIAS] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoria(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    categoria === c
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {lista.map((m) => {
                const ativo = m.id === modeloId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => escolher(m.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      ativo ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{m.nome}</span>
                      {ativo && <Check className="size-4 shrink-0 text-primary" />}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m.paraQuem}</p>
                    <div className="mt-2 flex gap-0.5">
                      {m.etapas.map((e) => (
                        <span
                          key={e.nome}
                          className="h-1.5 flex-1 rounded-full"
                          style={{ backgroundColor: funcaoInfo(e.funcao).cor }}
                          title={e.nome}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prévia */}
          <div className="p-4 md:overflow-y-auto">
            <Label className="text-muted-foreground">Nome do funil</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={modelo.nome}
              className="mt-2 border-border bg-muted text-foreground"
            />

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Etapas · {modelo.etapas.length}
            </h3>
            <ol className="mt-2 space-y-1.5">
              {modelo.etapas.map((e, i) => {
                const f = funcaoInfo(e.funcao);
                return (
                  <li key={e.nome} className="flex gap-3 rounded-lg border border-border bg-card p-2.5">
                    <span className="mt-0.5 font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{e.nome}</span>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: `${f.cor}22`, color: f.cor }}
                        >
                          {f.label}
                        </span>
                        {diasDaEtapa(e) != null && (
                          <span className="text-[10px] text-muted-foreground">
                            até {diasDaEtapa(e)}d
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{e.criterio}</p>
                      {toquesDaEtapa(modelo.id, e).length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {toquesDaEtapa(modelo.id, e).map((t) => (
                            <li
                              key={`${t.dia}-${t.acao}`}
                              className="text-[11px] text-foreground/80"
                              title={t.mensagem}
                            >
                              <span className="font-mono text-muted-foreground">D{t.dia}</span>{" "}
                              {t.canal} · {t.acao}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Motivos de perda
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {modelo.motivosPerda.map((r) => (
                <span key={r} className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground">
                  {r}
                </span>
              ))}
            </div>

            {modelo.campos.length > 0 && (
              <>
                <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Campos do contato
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {modelo.campos.map((c) => (
                    <span key={c} className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground">
                      {c}
                    </span>
                  ))}
                </div>
              </>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Motivos e campos valem para a conta toda; só entram os que ainda não existem.
            </p>
            {modelo.id === "recuperacao" && (
              <p className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs text-foreground">
                Depois de criar, ligue a Voomp ou a Hotmart em Configurações → Webhooks e
                escolha este funil: os eventos já se encaixam nas etapas sozinhos.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </Button>
          <Button
            onClick={criar}
            disabled={criando}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {criando ? "Criando..." : "Criar funil"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
