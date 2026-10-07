"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Search } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { contactSearchFilter } from "@/lib/contacts/search";
import type { Contact } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const PAGE_SIZE = 20;

// Escolher contato digitando. Substitui o <select> com a agenda inteira —
// em conta com milhares de contatos ele virava rolagem infinita e ainda
// parava em 1.000 linhas (limite do PostgREST), escondendo o resto.
// Mesma busca da "Nova conversa": nome, telefone, e-mail, @ do Instagram.
export function ContactCombobox({
  value,
  onSelect,
  disabled = false,
  placeholder = "Buscar contato por nome, telefone ou e-mail",
}: {
  value: Contact | null;
  onSelect: (contact: Contact) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { accountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  // Resposta de busca vencida (digitação rápida) é descartada.
  const requestRef = useRef(0);

  const search = useCallback(
    async (term: string) => {
      if (!accountId) return;
      const token = ++requestRef.current;
      setLoading(true);
      let q = createClient().from("contacts").select("*").eq("account_id", accountId);
      const filter = contactSearchFilter(term);
      if (filter) q = q.or(filter);
      const { data } = await q.order("updated_at", { ascending: false }).limit(PAGE_SIZE);
      if (token !== requestRef.current) return;
      setResults((data ?? []) as Contact[]);
      setLoading(false);
    },
    [accountId],
  );

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void search(query), query.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, query, search]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted px-2.5 text-left text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>
          {value ? value.name || value.phone : "Selecione um contato"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--anchor-width)] min-w-72 border-border bg-popover p-0">
        <div className="flex items-center gap-2 border-b border-border px-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="h-9 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {!loading && results.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {query.trim() ? "Nenhum contato encontrado." : "Nenhum contato ainda."}
            </p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted ${
                  value?.id === c.id ? "bg-muted" : ""
                }`}
              >
                <span className="text-sm text-foreground">{c.name || c.phone || "Sem nome"}</span>
                {(c.phone || c.email) && (
                  <span className="text-[11px] text-muted-foreground">
                    {[c.name ? c.phone : null, c.email].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            ))
          )}
          {!query.trim() && results.length === PAGE_SIZE && (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
              Mostrando os {PAGE_SIZE} mais recentes — digite para encontrar os demais.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
