"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "@/types";

/**
 * Rede de segurança: mesmo com o WebSocket morto (aba estrangulada em
 * segundo plano, wi-fi caindo, canal zumbi), o contador se recompõe
 * sozinho neste intervalo. É uma leitura de duas colunas — barata o
 * bastante para rodar sempre, e o próprio navegador já estrangula o
 * timer para ~1x/min quando a aba está oculta.
 */
const POLL_INTERVAL_MS = 45_000;
const MAX_RETRY_DELAY_MS = 30_000;

export interface UnreadCounts {
  /** Conversas com ao menos uma mensagem não lida. Alimenta o badge. */
  conversations: number;
  /** Soma das mensagens não lidas. Alimenta o alerta sonoro/notificação:
   *  uma 2ª mensagem numa conversa já pendente não muda a contagem de
   *  conversas, mas continua sendo algo novo para avisar. */
  messages: number;
}

const EMPTY: UnreadCounts = { conversations: 0, messages: 0 };

/**
 * Unread counters for the current user. Used by the sidebar to surface a
 * green dot on the Inbox nav entry when the user is elsewhere in the app,
 * e pelo hook de alertas para avisar sem depender da aba.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useUnreadCounts(): UnreadCounts {
  const [total, setTotal] = useState<UnreadCounts>(EMPTY);

  // Keep a live local mirror of {id: unread_count} so INSERT/UPDATE/DELETE
  // events can adjust the total in O(1) without refetching.
  const countsRef = useRef<Map<string, number>>(new Map());
  const cancelledRef = useRef(false);

  const recompute = useCallback(() => {
    let conversations = 0;
    let messages = 0;
    for (const n of countsRef.current.values()) {
      if (n > 0) {
        conversations += 1;
        messages += n;
      }
    }
    setTotal((prev) =>
      prev.conversations === conversations && prev.messages === messages
        ? prev
        : { conversations, messages },
    );
  }, []);

  // Releitura completa. RLS já escopa para a conta ativa — sem filtro
  // explícito de usuário aqui.
  const refetch = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, unread_count");
    if (cancelledRef.current || error || !data) return;

    const map = new Map<string, number>();
    for (const row of data as { id: string; unread_count: number }[]) {
      map.set(row.id, row.unread_count ?? 0);
    }
    countsRef.current = map;
    recompute();
  }, [recompute]);

  const [retryToken, setRetryToken] = useState(0);
  const retryAttemptRef = useRef(0);

  useEffect(() => {
    cancelledRef.current = false;
    const supabase = createClient();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleResubscribe = () => {
      if (cancelledRef.current || retryTimer !== null) return;
      const attempt = retryAttemptRef.current++;
      const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelledRef.current) setRetryToken((n) => n + 1);
      }, delay);
    };

    refetch();

    const channel = supabase
      .channel("total-unread-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const map = countsRef.current;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            map.set(row.id, row.unread_count ?? 0);
          }
          // Recompute — cheap, conversations per user stay small.
          recompute();
        },
      )
      .subscribe((status) => {
        if (cancelledRef.current) return;
        if (status === "SUBSCRIBED") {
          retryAttemptRef.current = 0;
          // Reinscrição depois de uma queda: o que passou enquanto o
          // canal estava fora não volta, então relemos.
          refetch();
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          scheduleResubscribe();
        }
      });

    const interval = setInterval(refetch, POLL_INTERVAL_MS);

    // Voltar para a aba / recuperar a rede são os momentos em que o
    // buraco de eventos é maior; releitura imediata nos dois.
    const onWake = () => {
      if (document.visibilityState === "visible") refetch();
    };
    const onOnline = () => refetch();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onOnline);

    return () => {
      cancelledRef.current = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onOnline);
      supabase.removeChannel(channel);
    };
  }, [refetch, recompute, retryToken]);

  return total;
}

/**
 * Compatibilidade: o badge da sidebar sempre contou CONVERSAS.
 */
export function useTotalUnread(): number {
  return useUnreadCounts().conversations;
}
