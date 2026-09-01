"use client";

/**
 * Notas do negócio — múltiplas, com título.
 *
 * A fonte da verdade é a tabela `deal_notes`. A coluna `deals.notes`
 * continua existindo como ESPELHO derivado (mantido por trigger no banco),
 * então tudo que ainda lê a coluna antiga — painel /leads, diag-cadencia,
 * importação do Meta, webhook de gateway — segue funcionando sem alteração.
 * Por isso este componente NUNCA escreve em `deals.notes`: escreve só aqui.
 *
 * Notas de tipo automático (`diagnostico`, `qualificacao_sdr`) são criadas
 * pelo banco. O usuário pode editar o corpo, mas não apagar nem renomear —
 * apagar o diagnóstico quebraria o painel de leads.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Trash2, X, Check, Lock } from "lucide-react";

export interface DealNote {
  id: string;
  deal_id: string;
  account_id: string;
  title: string;
  body: string;
  kind: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Tipos criados pelo banco — protegidos contra exclusão/renomeação. */
const KINDS_PROTEGIDOS = new Set(["diagnostico", "qualificacao_sdr", "importada"]);

const ROTULO_KIND: Record<string, string> = {
  diagnostico: "do formulário",
  qualificacao_sdr: "da SDR",
  importada: "importada",
};

function dataCurta(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function DealNotes({
  dealId,
  accountId,
}: {
  dealId: string;
  accountId: string;
}) {
  const supabase = createClient();
  const [notas, setNotas] = useState<DealNote[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunhoCorpo, setRascunhoCorpo] = useState("");
  const [rascunhoTitulo, setRascunhoTitulo] = useState("");

  const [criando, setCriando] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novoCorpo, setNovoCorpo] = useState("");

  // Sem setState síncrono aqui: o primeiro statement é o await, então o
  // estado só muda depois da resposta (evita render em cascata).
  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("deal_notes")
      .select("*")
      .eq("deal_id", dealId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) toast.error("Não consegui carregar as notas.");
    setNotas((data as DealNote[]) ?? []);
    setCarregando(false);
  }, [dealId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  async function criar() {
    const titulo = novoTitulo.trim();
    if (!titulo) return toast.error("Dá um título pra nota.");
    setSalvando(true);
    const { error } = await supabase.from("deal_notes").insert({
      deal_id: dealId,
      account_id: accountId,
      title: titulo,
      body: novoCorpo,
      kind: "manual",
      position: 100,
    });
    setSalvando(false);
    if (error) return toast.error("Não consegui salvar a nota.");
    setNovoTitulo("");
    setNovoCorpo("");
    setCriando(false);
    void carregar();
  }

  async function salvarEdicao(nota: DealNote) {
    setSalvando(true);
    const patch: Partial<DealNote> = { body: rascunhoCorpo };
    if (!KINDS_PROTEGIDOS.has(nota.kind)) patch.title = rascunhoTitulo.trim() || nota.title;
    const { error } = await supabase.from("deal_notes").update(patch).eq("id", nota.id);
    setSalvando(false);
    if (error) return toast.error("Não consegui salvar.");
    setEditandoId(null);
    void carregar();
  }

  async function excluir(nota: DealNote) {
    if (KINDS_PROTEGIDOS.has(nota.kind)) return;
    if (!confirm(`Apagar a nota "${nota.title}"? Isso não volta.`)) return;
    const { error } = await supabase.from("deal_notes").delete().eq("id", nota.id);
    if (error) return toast.error("Não consegui apagar.");
    void carregar();
  }

  if (carregando) {
    return <p className="text-sm text-muted-foreground">Carregando notas…</p>;
  }

  // `min-w-0` em toda a cadeia é obrigatório: sem isso o conteúdo das notas
  // (fbclid, UTMs, URL do PDF — tokens únicos de 100+ caracteres sem espaço)
  // força a largura mínima do container e empurra o painel inteiro pra fora
  // da tela, levando junto os botões.
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Label className="text-muted-foreground">Notas</Label>
        {!criando && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCriando(true)}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Plus className="size-3.5" />
            Nova nota
          </Button>
        )}
      </div>

      {criando && (
        <div className="grid min-w-0 gap-2 rounded-lg border border-primary/40 bg-muted/40 p-3">
          <Input
            autoFocus
            value={novoTitulo}
            onChange={(e) => setNovoTitulo(e.target.value)}
            placeholder="Título da nota (ex: Qualificação SDR)"
            className="h-8 w-full min-w-0 border-border bg-background text-sm"
          />
          <Textarea
            value={novoCorpo}
            onChange={(e) => setNovoCorpo(e.target.value)}
            placeholder="O que você quer registrar…"
            className="min-h-[90px] w-full min-w-0 border-border bg-background text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCriando(false);
                setNovoTitulo("");
                setNovoCorpo("");
              }}
            >
              Cancelar
            </Button>
            <Button type="button" size="sm" disabled={salvando} onClick={criar}>
              Salvar nota
            </Button>
          </div>
        </div>
      )}

      {notas.length === 0 && !criando && (
        <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          Nenhuma nota ainda.
        </p>
      )}

      {notas.map((nota) => {
        const protegida = KINDS_PROTEGIDOS.has(nota.kind);
        const editando = editandoId === nota.id;
        return (
          <div key={nota.id} className="min-w-0 rounded-lg border border-border bg-muted/40">
            <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
              {editando && !protegida ? (
                <Input
                  value={rascunhoTitulo}
                  onChange={(e) => setRascunhoTitulo(e.target.value)}
                  className="h-7 min-w-0 border-border bg-background text-sm"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {nota.title}
                </span>
              )}

              {protegida && (
                <Badge
                  variant="secondary"
                  className="hidden shrink-0 gap-1 text-[10px] font-normal sm:inline-flex"
                >
                  <Lock className="size-2.5" />
                  {ROTULO_KIND[nota.kind] ?? "automática"}
                </Badge>
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {dataCurta(nota.updated_at || nota.created_at)}
              </span>

              {editando ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={salvando}
                    onClick={() => void salvarEdicao(nota)}
                    aria-label="Salvar nota"
                  >
                    <Check className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setEditandoId(null)}
                    aria-label="Cancelar edição"
                  >
                    <X className="size-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setEditandoId(nota.id);
                      setRascunhoCorpo(nota.body);
                      setRascunhoTitulo(nota.title);
                    }}
                    aria-label="Editar nota"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  {!protegida && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => void excluir(nota)}
                      aria-label="Apagar nota"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>

            <div className="min-w-0 px-3 py-2">
              {editando ? (
                <Textarea
                  value={rascunhoCorpo}
                  onChange={(e) => setRascunhoCorpo(e.target.value)}
                  className="min-h-[160px] w-full min-w-0 border-border bg-background font-mono text-xs"
                />
              ) : (
                // `overflow-wrap: anywhere` é o que realmente quebra token
                // longo sem espaço (fbclid, URL do PDF). `break-words` sozinho
                // não quebra — e aí o painel inteiro estoura pro lado.
                <pre className="max-h-64 w-full min-w-0 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {nota.body || "—"}
                </pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
