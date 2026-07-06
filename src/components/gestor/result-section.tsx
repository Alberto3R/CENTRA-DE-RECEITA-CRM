import type { ComponentType, ReactNode } from "react";

// Bloco de resultado padronizado: cabeçalho fino com border-b + corpo. Evita o
// "tudo é card flutuante".
export function ResultSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

// Estado vazio composto (ícone + uma frase). Indica o próximo passo.
export function EmptyState({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" />
      <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

// Métrica em texto puro (sem caixinha), número em mono tabular.
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-lg font-semibold tabular-nums ${
          tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
