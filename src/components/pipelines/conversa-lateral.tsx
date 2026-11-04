"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Contact, Conversation, ConversationStatus, Deal, Message } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { MessageThread } from "@/components/inbox/message-thread";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button";
import { latestConversationId } from "./deal-card";

// Mesmo intervalo do resync de segurança do inbox: o WebSocket pode morrer
// em silêncio e a conversa aberta aqui ficaria congelada.
const POLL_INTERVAL_MS = 30_000;

interface ConversaLateralProps {
  /** Negócios da etapa que têm conversa, na ordem da coluna do funil. */
  deals: Deal[];
  /** Negócio aberto agora; `null` fecha o painel. */
  dealId: string | null;
  stageName: string;
  onDealChange: (dealId: string | null) => void;
}

/**
 * Conversa do lead aberta por cima do funil, sem sair da página. As setas
 * passam para o negócio anterior/seguinte da MESMA etapa, para a gestão ler
 * em sequência as conversas paradas numa etapa. O miolo é o mesmo
 * `MessageThread` do inbox (responder, assumir atendimento, status), com o
 * estado da conversa mantido aqui.
 */
export function ConversaLateral({
  deals,
  dealId,
  stageName,
  onDealChange,
}: ConversaLateralProps) {
  const index = dealId ? deals.findIndex((d) => d.id === dealId) : -1;
  const deal = index >= 0 ? deals[index] : null;
  const conversationId = deal ? latestConversationId(deal) : null;
  const open = !!deal && !!conversationId;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [resyncToken, setResyncToken] = useState(0);

  useEffect(() => {
    // Troca de negócio: limpa na hora para não mostrar a conversa anterior
    // enquanto a próxima carrega.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConversation(null);
    setMessages([]);
    if (!conversationId) return;
    let cancelled = false;
    createClient()
      .from("conversations")
      .select("*, contact:contacts(*)")
      .eq("id", conversationId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load conversation:", error.message);
          return;
        }
        const conv = data as (Conversation & { contact?: Contact | null }) | null;
        setConversation(conv);
        setContact(conv?.contact ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message }) => {
      const msg = event.new;
      if (msg.conversation_id !== conversationId) return;
      if (event.eventType === "INSERT") {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev.filter((m) => !m.id.startsWith("temp-")), msg];
        });
      } else if (event.eventType === "UPDATE") {
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
      }
    },
    [conversationId],
  );

  const handleConversationEvent = useCallback(
    (event: { eventType: string; new: Conversation }) => {
      if (event.eventType !== "UPDATE" || event.new.id !== conversationId) return;
      // O payload do realtime não traz o contato embutido; mantém o que já temos.
      setConversation((prev) => (prev ? { ...prev, ...event.new } : prev));
    },
    [conversationId],
  );

  useRealtime({
    channelName: "funil-conversa-lateral",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setResyncToken((n) => n + 1), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [open]);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  const handleUpdateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  }, []);

  const patchConversation = useCallback((patch: Partial<Conversation>) => {
    setConversation((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const anterior = index > 0 ? deals[index - 1] : null;
  const seguinte = index >= 0 && index < deals.length - 1 ? deals[index + 1] : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onDealChange(null)}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-border bg-popover p-0 text-popover-foreground sm:max-w-xl lg:max-w-2xl"
      >
        {/* Barra de navegação pela etapa. pr-12 deixa espaço pro X do Sheet. */}
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 pr-12">
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              disabled={!anterior}
              onClick={() => anterior && onDealChange(anterior.id)}
              aria-label="Conversa anterior da etapa"
              title="Conversa anterior da etapa"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!seguinte}
              onClick={() => seguinte && onDealChange(seguinte.id)}
              aria-label="Próxima conversa da etapa"
              title="Próxima conversa da etapa"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-sm font-semibold text-foreground">
              {deal?.title ?? "Conversa"}
            </SheetTitle>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {stageName} · {index + 1} de {deals.length}
            </p>
          </div>
          {conversationId && (
            <Link
              href={`/inbox?c=${conversationId}`}
              title="Abrir no inbox"
              className={buttonVariants({
                variant: "ghost",
                size: "sm",
                className: "shrink-0 text-muted-foreground hover:text-primary",
              })}
            >
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Inbox
            </Link>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          {conversation ? (
            <MessageThread
              conversation={conversation}
              contact={contact}
              messages={messages}
              onMessagesLoaded={setMessages}
              onNewMessage={handleNewMessage}
              onUpdateMessage={handleUpdateMessage}
              onStatusChange={(_id, status: ConversationStatus) => patchConversation({ status })}
              onAssignChange={(_id, assignedAgentId) =>
                patchConversation({ assigned_agent_id: assignedAgentId ?? undefined })
              }
              onHandoffChange={(_id, aiHandoff) => patchConversation({ ai_handoff: aiHandoff })}
              onBack={() => onDealChange(null)}
              resyncToken={resyncToken}
              onRefresh={() => setResyncToken((n) => n + 1)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              Carregando conversa…
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
