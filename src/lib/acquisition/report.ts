// Relatório de Aquisição (F3): tipos do RPC acquisition_report (mig 114) e as
// contas derivadas. Toda divisão por zero vira null ("—" na tela), nunca 0
// nem Infinity: número inventado é pior que número ausente.

export interface ChannelRow {
  channel_id: string | null;
  name: string;
  kind: string | null;
  position: number;
  leads: number;
  sales: number;
  revenue: number;
  won_no_value: number;
  /** Investimento total do canal: mídia + custos lançados (F4). */
  spend: number;
  media_spend: number;
  other_cost: number;
  meta_leads: number;
}

export interface CampaignRow {
  campaign_key: string;
  campaign_name: string | null;
  spend: number;
  meta_leads: number;
  leads: number;
  sales: number;
  revenue: number;
}

export interface WeekRow {
  week: string;
  spend: number;
  revenue: number;
  leads: number;
  sales: number;
}

export interface AcquisitionReport {
  period: { from: string; to: string };
  currency: string;
  settings: {
    attribution_model: 'first_touch' | 'last_touch';
    attribution_window_days: number;
    margin_pct: number | null;
    commission_pct: number | null;
  };
  channels: ChannelRow[];
  campaigns: CampaignRow[];
  weekly: WeekRow[];
  spend_currencies: string[];
  ad_accounts: {
    external_id: string;
    name: string | null;
    last_synced_at: string | null;
    last_sync_error: string | null;
  }[];
}

export const div = (a: number, b: number): number | null =>
  b > 0 ? a / b : null;

export interface Totals {
  leads: number;
  sales: number;
  revenue: number;
  spend: number;
  mediaSpend: number;
  otherCost: number;
  metaLeads: number;
  wonNoValue: number;
  cpl: number | null;
  cac: number | null;
  roas: number | null;
  conversion: number | null;
  /** receita × margem − comissão − investimento. Margem não informada = 100%. */
  result: number;
  marginKnown: boolean;
  unidentifiedLeads: number;
  unidentifiedSales: number;
}

export function rowMetrics(r: {
  leads: number;
  sales: number;
  revenue: number;
  spend: number;
}) {
  // Sem investimento registrado o custo é DESCONHECIDO, não zero: prospecção
  // e evento custam (time, estande) — entram quando a conta lança os custos
  // em Configurações → Aquisição (acquisition_costs, mig 115).
  const custo = r.spend > 0;
  return {
    cpl: custo ? div(r.spend, r.leads) : null,
    cac: custo ? div(r.spend, r.sales) : null,
    roas: div(r.revenue, r.spend),
    conversion: div(r.sales, r.leads),
  };
}

export function resultOf(
  revenue: number,
  spend: number,
  settings: Pick<AcquisitionReport['settings'], 'margin_pct' | 'commission_pct'>
): number {
  const margin = settings.margin_pct ?? 100;
  const commission = settings.commission_pct ?? 0;
  return (revenue * margin) / 100 - (revenue * commission) / 100 - spend;
}

export function totals(r: AcquisitionReport): Totals {
  const n = (v: unknown) => Number(v) || 0;
  const sum = (k: keyof ChannelRow) =>
    r.channels.reduce((s, c) => s + n(c[k]), 0);
  const t = {
    leads: sum('leads'),
    sales: sum('sales'),
    revenue: sum('revenue'),
    spend: sum('spend'),
    mediaSpend: sum('media_spend'),
    otherCost: sum('other_cost'),
    metaLeads: sum('meta_leads'),
    wonNoValue: sum('won_no_value'),
  };
  const unid = r.channels.find((c) => !c.channel_id);
  return {
    ...t,
    ...rowMetrics(t),
    result: resultOf(t.revenue, t.spend, r.settings),
    marginKnown: r.settings.margin_pct != null,
    unidentifiedLeads: n(unid?.leads),
    unidentifiedSales: n(unid?.sales),
  };
}

/** Período por preset, em datas locais (yyyy-mm-dd). */
export function presetRange(
  preset: '30' | '90' | 'month' | 'last_month',
  now = new Date()
) {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (preset === 'month') {
    return {
      from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: ymd(now),
    };
  }
  if (preset === 'last_month') {
    return {
      from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  const days = preset === '30' ? 30 : 90;
  return {
    from: ymd(new Date(now.getTime() - (days - 1) * 864e5)),
    to: ymd(now),
  };
}
