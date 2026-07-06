// Catálogo de planos do SaaS unificado (CRM + Gestor Comercial).
//
// Os créditos gateiam as capacidades do Gestor (análises e relatórios de IA).
// O CRM em si (inbox, contatos, funis) não consome crédito.
// `creditosMes = -1` significa ilimitado.

export type PlanId = "free" | "starter" | "pro" | "enterprise";

export interface Plan {
  id: PlanId;
  label: string;
  /** Preço mensal (cobrança mês a mês), em R$. */
  precoMensalReais: number;
  /** Preço/mês no plano anual, em R$ (null = sem anual). */
  precoAnualMensalReais: number | null;
  usuariosInclusos: number;
  precoUsuarioAdicionalReais: number;
  /** Créditos de Gestor por mês. -1 = ilimitado. */
  creditosMes: number;
  /** Env vars com os Stripe Price IDs (mensal/anual). null quando não comprável. */
  stripePriceEnvMensal: string | null;
  stripePriceEnvAnual: string | null;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    label: "Trial",
    precoMensalReais: 0,
    precoAnualMensalReais: null,
    usuariosInclusos: 1,
    precoUsuarioAdicionalReais: 0,
    creditosMes: 20,
    stripePriceEnvMensal: null,
    stripePriceEnvAnual: null,
  },
  starter: {
    id: "starter",
    label: "Starter",
    precoMensalReais: 497,
    precoAnualMensalReais: 397,
    usuariosInclusos: 3,
    precoUsuarioAdicionalReais: 197,
    creditosMes: 200,
    stripePriceEnvMensal: "STRIPE_PRICE_STARTER_MENSAL",
    stripePriceEnvAnual: "STRIPE_PRICE_STARTER_ANUAL",
  },
  pro: {
    id: "pro",
    label: "Pro",
    precoMensalReais: 927,
    precoAnualMensalReais: 797,
    usuariosInclusos: 5,
    precoUsuarioAdicionalReais: 197,
    creditosMes: 500,
    stripePriceEnvMensal: "STRIPE_PRICE_PRO_MENSAL",
    stripePriceEnvAnual: "STRIPE_PRICE_PRO_ANUAL",
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    precoMensalReais: 0,
    precoAnualMensalReais: null,
    usuariosInclusos: 10,
    precoUsuarioAdicionalReais: 197,
    creditosMes: -1,
    stripePriceEnvMensal: "STRIPE_PRICE_ENTERPRISE",
    stripePriceEnvAnual: null,
  },
};

export function isPlanId(x: unknown): x is PlanId {
  return x === "free" || x === "starter" || x === "pro" || x === "enterprise";
}

export function getPlan(id: string | null | undefined): Plan {
  return isPlanId(id) ? PLANS[id] : PLANS.free;
}
