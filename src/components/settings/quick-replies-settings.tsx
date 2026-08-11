"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Shield, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { normalizeShortcut } from "@/lib/inbox/quick-replies";
import type { QuickReply } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsChip } from "./settings-chip";

/**
 * Settings → Respostas rápidas. Atalhos de texto que o atendente aciona
 * digitando "/" no compositor do inbox.
 *
 * Não confundir com Modelos (message_templates): aquilo é HSM da Meta,
 * precisa de aprovação e serve para reabrir a janela de 24h. Isto é texto
 * livre, interno, e só existe para poupar digitação.
 */
export function QuickRepliesSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoAtalho, setNovoAtalho] = useState("");
  const [novoTexto, setNovoTexto] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchReplies = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from("quick_replies")
      .select("*")
      .eq("account_id", accountId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    setReplies((data as QuickReply[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  // O setLoading vive dentro do fetch (que é async); a regra não enxerga
  // isso e acusa cascading render. Mesmo escape hatch usado no inbox.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accountId) fetchReplies();
  }, [accountId, fetchReplies]);

  async function adicionar() {
    const atalho = normalizeShortcut(novoAtalho);
    const texto = novoTexto.trim();
    if (!atalho || !texto || !accountId) return;

    if (replies.some((r) => r.shortcut.toLowerCase() === atalho)) {
      toast.error(`O atalho /${atalho} já existe.`);
      return;
    }

    setCreating(true);
    const { error } = await supabase.from("quick_replies").insert({
      account_id: accountId,
      shortcut: atalho,
      content: texto,
      position: replies.length,
    });
    setCreating(false);

    if (error) {
      toast.error("Não foi possível adicionar (talvez sem permissão).");
      return;
    }
    setNovoAtalho("");
    setNovoTexto("");
    await fetchReplies();
  }

  async function salvar(
    r: QuickReply,
    campos: { shortcut?: string; content?: string },
  ): Promise<boolean> {
    const patch: Partial<QuickReply> = {};
    if (campos.shortcut !== undefined) {
      const atalho = normalizeShortcut(campos.shortcut);
      if (!atalho) return false;
      if (atalho === r.shortcut.toLowerCase()) return true;
      if (replies.some((x) => x.id !== r.id && x.shortcut.toLowerCase() === atalho)) {
        toast.error(`O atalho /${atalho} já existe.`);
        return false;
      }
      patch.shortcut = atalho;
    }
    if (campos.content !== undefined) {
      const texto = campos.content.trim();
      if (!texto || texto === r.content) return true;
      patch.content = texto;
    }
    if (Object.keys(patch).length === 0) return true;

    setBusyId(r.id);
    const { error } = await supabase
      .from("quick_replies")
      .update(patch)
      .eq("id", r.id);
    setBusyId(null);

    if (error) {
      toast.error("Não foi possível salvar.");
      return false;
    }
    await fetchReplies();
    return true;
  }

  async function excluir(r: QuickReply) {
    if (!window.confirm(`Excluir a resposta rápida /${r.shortcut}?`)) return;
    setBusyId(r.id);
    const { error } = await supabase
      .from("quick_replies")
      .delete()
      .eq("id", r.id);
    setBusyId(null);
    if (error) {
      toast.error("Não foi possível excluir.");
      return;
    }
    await fetchReplies();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          Respostas rápidas
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            Administrador
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Textos que o atendente insere digitando <code>/</code> no campo de
          mensagem do Inbox. São internos — diferente de Modelos, não passam por
          aprovação da Meta e não reabrem a janela de 24h.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEditSettings ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">/</span>
              <Input
                value={novoAtalho}
                onChange={(e) => setNovoAtalho(e.target.value)}
                placeholder="atalho"
                className="h-8 max-w-45 bg-muted text-foreground"
              />
              <Button
                onClick={adicionar}
                disabled={
                  creating || !normalizeShortcut(novoAtalho) || !novoTexto.trim()
                }
                className="ml-auto shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Adicionar
              </Button>
            </div>
            <Textarea
              value={novoTexto}
              onChange={(e) => setNovoTexto(e.target.value)}
              placeholder="Texto que será inserido na mensagem…"
              rows={3}
              className="bg-muted text-foreground"
            />
          </div>
        ) : null}

        <div className="max-h-96 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando…
            </div>
          ) : replies.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma resposta rápida ainda. Crie a primeira acima — ela aparece
              no Inbox assim que o atendente digitar <code>/</code>.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {replies.map((r) => (
                <ReplyRow
                  key={r.id}
                  reply={r}
                  busy={busyId === r.id}
                  editable={canEditSettings}
                  onSave={salvar}
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

function ReplyRow({
  reply,
  busy,
  editable,
  onSave,
  onDelete,
}: {
  reply: QuickReply;
  busy: boolean;
  editable: boolean;
  onSave: (
    r: QuickReply,
    campos: { shortcut?: string; content?: string },
  ) => Promise<boolean>;
  onDelete: (r: QuickReply) => void;
}) {
  const [atalho, setAtalho] = useState(reply.shortcut);
  const [texto, setTexto] = useState(reply.content);

  async function commitAtalho() {
    if (normalizeShortcut(atalho) === reply.shortcut.toLowerCase()) return;
    const ok = await onSave(reply, { shortcut: atalho });
    if (!ok) setAtalho(reply.shortcut);
  }

  async function commitTexto() {
    if (texto.trim() === reply.content) return;
    const ok = await onSave(reply, { content: texto });
    if (!ok) setTexto(reply.content);
  }

  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">/</span>
        <Input
          value={atalho}
          disabled={busy || !editable}
          onChange={(e) => setAtalho(e.target.value)}
          onBlur={commitAtalho}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="h-8 max-w-45 border-transparent bg-transparent font-medium text-foreground hover:border-border focus:border-primary"
        />
        {editable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => onDelete(reply)}
            title="Excluir resposta rápida"
            className="ml-auto shrink-0 text-muted-foreground hover:text-red-400"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        ) : null}
      </div>
      <Textarea
        value={texto}
        disabled={busy || !editable}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={commitTexto}
        rows={2}
        className="border-transparent bg-transparent text-sm text-muted-foreground hover:border-border focus:border-primary"
      />
    </li>
  );
}
