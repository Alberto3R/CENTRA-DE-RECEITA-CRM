"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact } from "@/types";
import { Loader2, Search, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContactForm } from "@/components/contacts/contact-form";
import { contactSearchFilter } from "@/lib/contacts/search";
import {
  InstagramGlyph,
  contactDisplayName,
  contactInitial,
  contactSubtitle,
  isInstagramContact,
} from "./channel-display";

/**
 * "Nova conversa" — escolhe um contato existente ou cria um na hora.
 *
 * Antes, falar com alguém que ainda não tinha escrito exigia sair do inbox,
 * ir em Contatos, criar/achar o contato e voltar. A conversa só existia como
 * efeito colateral de uma mensagem recebida.
 *
 * O diálogo não cria a conversa: devolve o contato escolhido em
 * `onPickContact` e deixa a página do inbox criar e abrir a thread. Assim o
 * estado da lista (seleção, badge de não-lidas, URL) continua com um dono só.
 */

const PAGE_SIZE = 25;

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Recebe o contato escolhido. Deve resolver quando a conversa estiver
   * aberta — o diálogo mantém o spinner até lá e só então se fecha, para o
   * clique não parecer perdido enquanto a chamada acontece.
   */
  onPickContact: (contactId: string) => Promise<void>;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onPickContact,
}: NewConversationDialogProps) {
  const { accountId } = useAuth();
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [contactFormOpen, setContactFormOpen] = useState(false);

  // Cada busca carrega um token; respostas de um token vencido são
  // descartadas. Sem isso, digitar rápido faz a resposta de "jo" chegar
  // depois da de "joão" e sobrescrever a lista com o resultado errado.
  const requestRef = useRef(0);

  const search = useCallback(
    async (term: string) => {
      if (!accountId) return;
      const token = ++requestRef.current;
      setLoading(true);

      const supabase = createClient();
      let q = supabase
        .from("contacts")
        .select("*")
        .eq("account_id", accountId);

      const filter = contactSearchFilter(term);
      if (filter) q = q.or(filter);

      const { data, error } = await q
        .order("updated_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (token !== requestRef.current) return;
      if (error) {
        console.error("Falha ao buscar contatos:", error.message);
        setContacts([]);
      } else {
        setContacts((data ?? []) as Contact[]);
      }
      setLoading(false);
    },
    [accountId],
  );

  // Debounce da digitação. Ao abrir, roda imediatamente para a lista já
  // aparecer preenchida com os contatos mais recentes.
  useEffect(() => {
    if (!open) return;
    const delay = query.trim() ? 250 : 0;
    const timer = setTimeout(() => void search(query), delay);
    return () => clearTimeout(timer);
  }, [open, query, search]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setStartingId(null);
    }
  }, [open]);

  const handlePick = useCallback(
    async (contactId: string) => {
      if (startingId) return;
      setStartingId(contactId);
      try {
        await onPickContact(contactId);
        onOpenChange(false);
      } finally {
        setStartingId(null);
      }
    },
    [onPickContact, onOpenChange, startingId],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova conversa</DialogTitle>
            <DialogDescription>
              Escolha um contato para abrir a conversa. Se ele ainda não existe,
              dá para criar aqui mesmo.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, telefone, e-mail ou @"
              className="border-border bg-muted pl-9 text-sm"
            />
          </div>

          <ScrollArea className="-mx-1 h-72 px-1">
            {loading && contacts.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {query.trim()
                    ? `Nenhum contato encontrado para "${query.trim()}".`
                    : "Nenhum contato cadastrado ainda."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setContactFormOpen(true)}
                >
                  <UserPlus className="size-4" />
                  Criar contato
                </Button>
              </div>
            ) : (
              <div className="flex flex-col">
                {contacts.map((contact) => {
                  const busy = startingId === contact.id;
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => void handlePick(contact.id)}
                      disabled={startingId !== null}
                      className="flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
                    >
                      <div className="relative shrink-0">
                        {contact.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={contact.avatar_url}
                            alt=""
                            className="size-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                            {contactInitial(contact)}
                          </div>
                        )}
                        {isInstagramContact(contact) && (
                          <InstagramGlyph className="absolute -bottom-0.5 -right-0.5 size-3.5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {contactDisplayName(contact)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {contactSubtitle(contact)}
                        </p>
                      </div>

                      {busy && (
                        <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {contacts.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setContactFormOpen(true)}
              disabled={startingId !== null}
              className="w-full"
            >
              <UserPlus className="size-4" />
              Criar contato
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* Mesmo formulário da página de Contatos — inclusive a checagem de
          telefone duplicado. Ao salvar, já emendamos na conversa: criar o
          contato aqui só faz sentido se levar direto ao atendimento. */}
      <ContactForm
        open={contactFormOpen}
        onOpenChange={setContactFormOpen}
        onSaved={(contactId) => {
          setContactFormOpen(false);
          if (contactId) void handlePick(contactId);
          else void search(query);
        }}
      />
    </>
  );
}
