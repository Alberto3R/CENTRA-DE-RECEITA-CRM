"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { playChime } from "@/lib/alerts/chime";
import type { UnreadCounts } from "@/hooks/use-total-unread";

const PREF_KEY = "wacrm:alerts:enabled";
/** Sincroniza as instâncias do hook na mesma aba (o `storage` do browser
 *  só avisa as OUTRAS abas). */
const CHANGED_EVENT = "wacrm:alerts-changed";
/** Não repetir o som mais de uma vez nesse intervalo. */
const CHIME_THROTTLE_MS = 5_000;

export function isAlertsEnabled(): boolean {
  try {
    // Padrão LIGADO: quem precisa do aviso é justamente quem ainda não
    // sabe que existe um botão para ligá-lo.
    return localStorage.getItem(PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeAlertsEnabled(value: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, String(value));
  } catch {
    // Modo anônimo / storage bloqueado: vale só para esta sessão.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Estado do botão de avisos (o sino do cabeçalho). Separado do hook que
 * dispara os avisos porque quem renderiza o botão não é quem conta as
 * não lidas.
 */
export function useAlertsPreference() {
  // Sempre `true` no primeiro render: ler localStorage no initializer
  // divergiria do HTML do servidor (hydration mismatch). O efeito abaixo
  // concilia logo depois da montagem.
  const [enabled, setEnabled] = useState(true);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");

  useEffect(() => {
    const sync = () => {
      setEnabled(isAlertsEnabled());
      setPermission(notificationPermission());
    };
    sync();
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback(async () => {
    const next = !isAlertsEnabled();
    writeAlertsEnabled(next);
    // Ligar é o gesto do usuário que o navegador exige para pedir
    // permissão de notificação — aproveitamos ele.
    if (next && notificationPermission() === "default") {
      try {
        const result = await Notification.requestPermission();
        setPermission(result);
      } catch {
        // Alguns navegadores rejeitam fora de contexto seguro.
      }
    }
    return next;
  }, []);

  return { enabled, permission, toggle };
}

/**
 * Avisa que chegou mensagem nova sem depender de o usuário estar olhando
 * o inbox: contador no título da aba (sempre), som e notificação do
 * sistema (quando ligado e a janela não está em foco).
 *
 * O gatilho é a SUBIDA do contador de não lidas — não o evento realtime.
 * Isso é de propósito: o contador também é reconstruído por polling, então
 * o aviso continua funcionando mesmo quando o WebSocket morre, que é
 * justamente o cenário em que o aviso mais importa.
 */
export function useUnreadAlerts(counts: UnreadCounts): void {
  const router = useRouter();
  const pathname = usePathname();
  const previousRef = useRef<number | null>(null);
  const lastChimeRef = useRef(0);

  // Contador no título da aba. Recalculado a cada navegação porque o
  // Next reescreve document.title ao trocar de rota.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title =
      counts.conversations > 0 ? `(${counts.conversations}) ${base}` : base;
  }, [counts.conversations, pathname]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = counts.messages;

    // Primeira leitura da sessão não é "chegou agora".
    if (previous === null || counts.messages <= previous) return;
    if (!isAlertsEnabled()) return;

    // Já está com o CRM na frente: o próprio inbox mostra a mensagem.
    const watching =
      document.visibilityState === "visible" && document.hasFocus();
    if (watching) return;

    const now = Date.now();
    if (now - lastChimeRef.current > CHIME_THROTTLE_MS) {
      lastChimeRef.current = now;
      playChime();
    }

    if (notificationPermission() !== "granted") return;
    try {
      const novas = counts.messages - previous;
      const notification = new Notification("Nova mensagem no CRM", {
        body:
          novas === 1
            ? "1 mensagem nova esperando resposta."
            : `${novas} mensagens novas esperando resposta.`,
        // Substitui a notificação anterior em vez de empilhar uma pilha
        // de avisos idênticos.
        tag: "wacrm-unread",
        icon: "/favicon.ico",
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
        router.push("/inbox");
      };
    } catch {
      // Notificação é enfeite: nunca pode derrubar a tela.
    }
  }, [counts.messages, router]);
}
