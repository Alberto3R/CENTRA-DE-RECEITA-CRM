"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Conversation } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
}

/** Teto do backoff de reinscrição. */
const MAX_RETRY_DELAY_MS = 30_000;

export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Store latest callbacks in refs to avoid re-subscribing when the
  // parent re-renders with fresh closures. Assigned inside an effect
  // so the mutation doesn't happen during render (React 19's refs
  // rule) — subscribers only read `.current` inside async Realtime
  // callbacks, which always run after the render that updates it.
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  /**
   * Bumped quando o canal cai (CHANNEL_ERROR / TIMED_OUT / CLOSED) para
   * refazer a inscrição. Sem isso um socket "zumbi" — o canal morre mas
   * o supabase-js não recria a inscrição — deixa a tela congelada até o
   * usuário recarregar: foi exatamente o que aconteceu com a aba da SDR
   * ficando horas em segundo plano (o navegador estrangula os timers, o
   * servidor derruba o canal por heartbeat perdido e nada mais chega).
   */
  const [retryToken, setRetryToken] = useState(0);
  // Contador de tentativas seguidas, para o backoff exponencial. Zera a
  // cada SUBSCRIBED.
  const retryAttemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleResubscribe = () => {
      if (cancelled || retryTimer !== null) return;
      const attempt = retryAttemptRef.current++;
      const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelled) setRetryToken((n) => n + 1);
      }, delay);
    };

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload) => {
          onMessageRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Message>["eventType"],
            new: payload.new as Message,
            old: payload.old as Partial<Message>,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          onConversationRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Conversation>["eventType"],
            new: payload.new as Conversation,
            old: payload.old as Partial<Conversation>,
          });
        }
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          retryAttemptRef.current = 0;
          setIsConnected(true);
          return;
        }
        // Qualquer outro estado é "não estamos recebendo eventos". O
        // consumidor usa esse false → true seguinte como gatilho de
        // resync, então marcar aqui é o que fecha o buraco.
        setIsConnected(false);
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          scheduleResubscribe();
        }
      });

    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [channelName, enabled, retryToken]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { isConnected, unsubscribe };
}
