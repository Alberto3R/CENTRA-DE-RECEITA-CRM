// Créditos do Gestor: gating de uso por plano, ponderado por tipo de análise.
//
// `assertCreditos` roda no TOPO de toda rota de IA (após requireRole) e lança
// ForbiddenError (→ 403) se o crédito do mês não cobre o custo da ação.
// `consumirCreditos` debita o custo APÓS o sucesso da operação.
//
// O saldo vive em usage_counters (unidade = 'creditos', um contador por mês/conta),
// incrementado pela RPC `increment_usage_counter(account, periodo, unidade, delta)`.

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { ForbiddenError } from "@/lib/auth/account";
import { getPlan, type Plan } from "./plans";

/** Capacidades do Gestor que consomem crédito. */
export type Capacidade =
  | "analise-call"
  | "whatsapp"
  | "raio-x"
  | "pauta-funil"
  | "coaching"
  | "pdi"
  | "scripts"
  | "contragolpe"
  | "followup"
  | "campanhas";

/**
 * Peso em créditos por tipo. Análises pesadas (call/whatsapp, que rodam Sonnet
 * sobre transcrição longa) custam mais; gerações curtas custam 1.
 */
export const CUSTO_CREDITOS: Record<Capacidade, number> = {
  "analise-call": 3,
  whatsapp: 3,
  "raio-x": 2,
  "pauta-funil": 2,
  coaching: 2,
  pdi: 2,
  scripts: 1,
  contragolpe: 1,
  followup: 1,
  campanhas: 1,
};

function periodoAtual(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

async function planoDaConta(accountId: string): Promise<Plan> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("accounts")
    .select("plan, subscription_status")
    .eq("id", accountId)
    .maybeSingle<{ plan: string | null; subscription_status: string | null }>();
  const status = data?.subscription_status;
  // Assinatura vencida/cancelada cai para o trial (free).
  if (status && status !== "active" && status !== "trialing") {
    return getPlan("free");
  }
  return getPlan(data?.plan ?? "free");
}

async function creditosUsados(accountId: string): Promise<number> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("usage_counters")
    .select("contador")
    .eq("account_id", accountId)
    .eq("periodo", periodoAtual())
    .eq("unidade", "creditos")
    .maybeSingle<{ contador: number }>();
  return data?.contador ?? 0;
}

export interface SaldoCreditos {
  plano: PlanResumo;
  total: number; // -1 = ilimitado
  usados: number;
  restantes: number; // Infinity se ilimitado
}
interface PlanResumo {
  id: string;
  label: string;
}

/** Saldo de créditos do mês (para UI de uso/upsell). */
export async function saldoCreditos(accountId: string): Promise<SaldoCreditos> {
  const plan = await planoDaConta(accountId);
  const usados = await creditosUsados(accountId);
  const total = plan.creditosMes;
  return {
    plano: { id: plan.id, label: plan.label },
    total,
    usados,
    restantes: total < 0 ? Infinity : Math.max(0, total - usados),
  };
}

/**
 * Garante que a conta tem crédito para a `capacidade`. Lança ForbiddenError (403)
 * com mensagem de upsell quando o saldo não cobre o custo. Não debita.
 */
export async function assertCreditos(
  accountId: string,
  capacidade: Capacidade,
): Promise<void> {
  const plan = await planoDaConta(accountId);
  if (plan.creditosMes < 0) return; // ilimitado

  const usados = await creditosUsados(accountId);
  const custo = CUSTO_CREDITOS[capacidade];
  const restantes = Math.max(0, plan.creditosMes - usados);
  if (restantes < custo) {
    throw new ForbiddenError(
      `Créditos do plano ${plan.label} esgotados (${plan.creditosMes}/mês). ` +
        `Restam ${restantes}; esta ação custa ${custo}. Faça upgrade do plano para continuar.`,
    );
  }
}

/**
 * Debita o custo da `capacidade` no contador do mês (idempotente via RPC
 * SECURITY DEFINER). Chamado APÓS o sucesso. Falha de telemetria não derruba a
 * operação: loga e segue.
 */
export async function consumirCreditos(
  accountId: string,
  capacidade: Capacidade,
): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await admin.rpc("increment_usage_counter", {
    p_account_id: accountId,
    p_periodo: periodoAtual(),
    p_unidade: "creditos",
    p_delta: CUSTO_CREDITOS[capacidade],
  });
  if (error) {
    console.error(`[creditos] falha ao debitar ${capacidade}: ${error.message}`);
  }
}
