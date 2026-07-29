"use client";

import { useState } from "react";
import type { SyntheticEvent } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type TagLite = { id: string; name: string; color: string };

// Paleta pra tags criadas na hora (mesma do gerenciador de tags).
const PRESET = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

// Tags do contato exibidas no card do funil, com anexar/remover inline.
// Anexar/remover exige agent+ (RLS contact_tags); criar tag nova exige
// admin (RLS tags). onChanged recarrega os negócios do board.
export function DealCardTags({
  contactId,
  current,
  onChanged,
}: {
  contactId: string;
  current: TagLite[];
  onChanged: () => void;
}) {
  const supabase = createClient();
  const { accountId, canSendMessages, canEditSettings } = useAuth();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<TagLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  const canWrite = canSendMessages; // anexar/remover
  const canCreate = canEditSettings; // criar tag nova
  const currentIds = new Set(current.map((t) => t.id));
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  if (current.length === 0 && !canWrite) return null;

  async function loadAll() {
    if (!accountId) return;
    const { data } = await supabase
      .from("tags")
      .select("id, name, color")
      .eq("account_id", accountId)
      .order("name");
    setAll((data as TagLite[]) ?? []);
  }

  async function attach(tagId: string) {
    setBusy(true);
    const { error } = await supabase
      .from("contact_tags")
      .insert({ contact_id: contactId, tag_id: tagId });
    setBusy(false);
    if (error) return toast.error("Falha ao adicionar tag");
    onChanged();
  }

  async function detach(tagId: string) {
    setBusy(true);
    const { error } = await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", contactId)
      .eq("tag_id", tagId);
    setBusy(false);
    if (error) return toast.error("Falha ao remover tag");
    onChanged();
  }

  async function createAndAttach() {
    const name = newName.trim();
    if (!name || !accountId) return;
    if (all.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const color = PRESET[all.length % PRESET.length];
    const { data: created, error } = await supabase
      .from("tags")
      .insert({ account_id: accountId, user_id: user.id, name, color })
      .select("id, name, color")
      .single();
    if (error || !created) {
      setBusy(false);
      return toast.error("Falha ao criar tag");
    }
    const { error: e2 } = await supabase
      .from("contact_tags")
      .insert({ contact_id: contactId, tag_id: created.id });
    setBusy(false);
    if (e2) return toast.error("Tag criada, mas falha ao anexar");
    setNewName("");
    onChanged();
    loadAll();
  }

  const q = newName.trim().toLowerCase();
  const available = all.filter(
    (t) => !currentIds.has(t.id) && (!q || t.name.toLowerCase().includes(q)),
  );
  const exactExists = all.some((t) => t.name.toLowerCase() === q);

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1"
      onClick={stop}
      onPointerDown={stop}
    >
      {current.map((t) => (
        <span
          key={t.id}
          className="group/tag inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: `${t.color}20`, color: t.color }}
        >
          {t.name}
          {canWrite && (
            <button
              type="button"
              aria-label={`Remover ${t.name}`}
              disabled={busy}
              onClick={() => detach(t.id)}
              className="opacity-60 transition-opacity hover:text-foreground group-hover/tag:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}

      {canWrite && (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) loadAll();
          }}
        >
          <PopoverTrigger
            onPointerDown={stop}
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Plus className="h-2.5 w-2.5" /> tag
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56" onClick={stop} onPointerDown={stop}>
            {canCreate && (
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && q && !exactExists) createAndAttach();
                }}
                placeholder="Buscar ou criar tag…"
                className="h-8 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
              />
            )}
            <div className="mt-1 max-h-48 overflow-y-auto">
              {available.length === 0 && !q && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Nenhuma tag disponível
                </p>
              )}
              {available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={busy}
                  onClick={() => attach(t.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
              {canCreate && q && !exactExists && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={createAndAttach}
                  className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-primary hover:bg-muted"
                >
                  <Plus className="h-3 w-3" /> Criar “{newName.trim()}”
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
