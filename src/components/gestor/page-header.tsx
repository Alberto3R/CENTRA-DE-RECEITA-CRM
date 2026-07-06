import type { ReactNode } from "react";

import { CreditChip } from "./credit-chip";

// Cabeçalho padrão das telas do Gestor: título (sem "IA"), subtítulo curto e
// um slot de ação à direita, com o chip de créditos. Separa do corpo por uma
// régua fina (border-b), não por card.
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <CreditChip />
      </div>
    </header>
  );
}
