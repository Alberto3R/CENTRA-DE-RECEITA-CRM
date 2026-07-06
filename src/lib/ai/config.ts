// Carrega a configuração de método comercial de uma conta (account_sales_config).
//
// Lê a tabela `account_sales_config` (migration 039) e resolve uma MetodoConfig.
// Se a conta não tem linha (ou não customizou), devolve o preset 3R de fábrica
// com `customizado: false` — os motores então usam o texto 3R verbatim.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONFIG_3R,
  DIMENSOES_3R,
  type DimensaoSpec,
  type MetodoConfig,
} from "./method-config";

interface SalesConfigRow {
  metodo_nome: string | null;
  tom_de_voz: string | null;
  icp: Record<string, unknown> | null;
  produto: Record<string, unknown> | null;
  oferta: Record<string, unknown> | null;
  dimensoes: DimensaoSpec[] | null;
  moeda: string | null;
}

/**
 * Resolve a MetodoConfig da conta. `supabase` pode ser o client RLS (sessão do
 * usuário) ou o service-role escopado por accountId — em ambos os casos lemos a
 * config da própria conta.
 */
export async function carregarSalesConfig(
  supabase: SupabaseClient,
  accountId: string,
): Promise<MetodoConfig> {
  const { data, error } = await supabase
    .from("account_sales_config")
    .select("metodo_nome, tom_de_voz, icp, produto, oferta, dimensoes, moeda")
    .eq("account_id", accountId)
    .maybeSingle<SalesConfigRow>();

  // Sem config (ou erro de leitura): cai no preset 3R — nunca derruba a análise.
  if (error || !data) {
    return CONFIG_3R;
  }

  const dimsCustom =
    Array.isArray(data.dimensoes) && data.dimensoes.length > 0
      ? data.dimensoes
      : null;

  const metodoNome = data.metodo_nome?.trim() || "3R";
  const tomDeVoz = data.tom_de_voz?.trim() || null;

  // "customizado" = a conta saiu do preset 3R em algum eixo que muda o prompt.
  const customizado =
    metodoNome !== "3R" || dimsCustom !== null || tomDeVoz !== null;

  return {
    metodoNome,
    tomDeVoz,
    icp: data.icp ?? null,
    produto: data.produto ?? null,
    oferta: data.oferta ?? null,
    dimensoes: dimsCustom ?? DIMENSOES_3R,
    moeda: data.moeda?.trim() || "BRL",
    customizado,
  };
}
