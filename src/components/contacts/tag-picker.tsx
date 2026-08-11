"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Tag } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TagPickerProps {
  /**
   * When set, every toggle is persisted to `contact_tags` immediately.
   * When null/undefined the picker is selection-only and the caller is
   * responsible for persisting (used by the contact creation form, where
   * the contact row does not exist yet).
   */
  contactId?: string | null;
  selectedTagIds: string[];
  /**
   * Receives both the id list and the resolved tag rows, so callers that
   * render pills don't need their own copy of the tag catalogue.
   */
  onChange: (nextIds: string[], nextTags: Tag[]) => void;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  /** Rendered inside the trigger button. Defaults to a compact "+" pill. */
  trigger?: React.ReactNode;
  className?: string;
}

export function TagPicker({
  contactId,
  selectedTagIds,
  onChange,
  disabled = false,
  align = "start",
  trigger,
  className,
}: TagPickerProps) {
  const { accountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [query, setQuery] = useState("");
  const [busyTagId, setBusyTagId] = useState<string | null>(null);

  const fetchTags = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("tags")
      .select("*")
      .eq("account_id", accountId)
      .order("name");
    if (data) setAllTags(data as Tag[]);
  }, [accountId]);

  // Only load the tag catalogue once the popover is actually opened —
  // the sidebar mounts on every conversation switch.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [open, fetchTags]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTags, query]);

  const resolve = useCallback(
    (ids: string[]) => allTags.filter((t) => ids.includes(t.id)),
    [allTags],
  );

  const toggleTag = useCallback(
    async (tagId: string) => {
      const isSelected = selectedTagIds.includes(tagId);
      const next = isSelected
        ? selectedTagIds.filter((id) => id !== tagId)
        : [...selectedTagIds, tagId];

      // Selection-only mode: the caller persists on submit.
      if (!contactId) {
        onChange(next, resolve(next));
        return;
      }

      setBusyTagId(tagId);
      onChange(next, resolve(next)); // optimistic

      const supabase = createClient();
      // `contact_tags` has no account_id column — tenancy is enforced through
      // the contact/tag rows themselves.
      const { error } = isSelected
        ? await supabase
            .from("contact_tags")
            .delete()
            .eq("contact_id", contactId)
            .eq("tag_id", tagId)
        : await supabase
            .from("contact_tags")
            .insert({ contact_id: contactId, tag_id: tagId });

      setBusyTagId(null);

      if (error) {
        onChange(selectedTagIds, resolve(selectedTagIds)); // rollback
        toast.error(
          isSelected ? "Falha ao remover a tag" : "Falha ao adicionar a tag",
        );
      }
    },
    [contactId, selectedTagIds, onChange, resolve],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          trigger ? (
            <button type="button" className={className} />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("h-6 gap-1 px-2 text-[10px]", className)}
            />
          )
        }
      >
        {trigger ?? (
          <>
            <Plus className="size-3" />
            Tag
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tag..."
            className="h-7 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            {allTags.length === 0
              ? "Nenhuma tag criada ainda. Crie em Configurações › Campos e tags."
              : "Nenhuma tag encontrada."}
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((tag) => (
              <label
                key={tag.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-muted/50"
              >
                <Checkbox
                  checked={selectedTagIds.includes(tag.id)}
                  disabled={busyTagId === tag.id}
                  onCheckedChange={() => toggleTag(tag.id)}
                  aria-label={`Marcar ${tag.name}`}
                />
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="truncate text-sm text-popover-foreground">
                  {tag.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Read-only pill row. Shared by the inbox sidebar and anywhere else that
 * renders a contact's tags, so the visual stays in one place.
 */
export function TagPills({
  tags,
  empty = "Nenhuma tag",
}: {
  tags: Pick<Tag, "id" | "name" | "color">[];
  empty?: string;
}) {
  if (tags.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <>
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
        >
          {tag.name}
        </span>
      ))}
    </>
  );
}
