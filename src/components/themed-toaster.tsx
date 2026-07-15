"use client";

import { useSyncExternalStore } from "react";
import { Toaster } from "sonner";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_MODE } from "@/lib/themes";

// Returns false during SSR and the first hydration render, true after —
// the sanctioned (warning-free, no setState-in-effect) way to diverge
// server vs client. Lets us match the server-rendered default on first
// paint, then adopt the real mode.
const noopSubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Toaster wrapper that tracks the active light/dark mode.
 *
 * Lives inside <ThemeProvider> (see layout.tsx) so it can read the
 * current mode and hand it to sonner. Colors are driven off the same
 * CSS tokens as the rest of the app, so a toast looks at home in
 * either mode without a second palette to maintain.
 *
 * The theme is gated behind `useIsClient`: the server renders
 * DEFAULT_MODE, so first client paint must too, otherwise a light-mode
 * user hydrates with a different sonner `theme` attribute than the
 * server emitted and React logs a hydration mismatch.
 */
export function ThemedToaster() {
  const { mode } = useTheme();
  const isClient = useIsClient();
  return (
    <Toaster
      theme={isClient ? mode : DEFAULT_MODE}
      position="top-right"
      // richColors = fundo tênue por status (verde/vermelho/âmbar), que já
      // adapta a claro/escuro. Ícones próprios (círculo cheio) e cantos/sombra
      // mais caprichados dão o acabamento — pra não ter cara de template.
      richColors
      icons={{
        success: <CircleCheck className="h-[18px] w-[18px]" strokeWidth={2.25} />,
        error: <CircleX className="h-[18px] w-[18px]" strokeWidth={2.25} />,
        warning: <TriangleAlert className="h-[18px] w-[18px]" strokeWidth={2.25} />,
        info: <Info className="h-[18px] w-[18px]" strokeWidth={2.25} />,
      }}
      toastOptions={{
        style: {
          borderRadius: "13px",
          padding: "13px 15px",
          gap: "11px",
          fontFamily: "var(--font-sans)",
          fontSize: "13.5px",
          boxShadow:
            "0 10px 30px -14px rgb(0 0 0 / 0.28), 0 2px 6px -3px rgb(0 0 0 / 0.10)",
        },
        classNames: {
          title: "font-medium leading-snug",
        },
      }}
    />
  );
}
