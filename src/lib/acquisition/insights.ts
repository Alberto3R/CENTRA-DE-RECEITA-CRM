// "O que olhar" do Relatório de Aquisição (F5): leituras automáticas do
// resultado do RPC, em ordem de gravidade. Regra de ouro: só aponta o que o
// número sustenta. Nada de "otimize seus criativos" — cada alerta nomeia a
// campanha/canal, o valor e por que importa.

import { rowMetrics, totals, type AcquisitionReport } from './report';

export type InsightLevel = 'critical' | 'warning' | 'info';

export interface Insight {
  id: string;
  level: InsightLevel;
  title: string;
  detail: string;
}

const ORDER: Record<InsightLevel, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function buildInsights(
  r: AcquisitionReport,
  fmt: (v: number) => string
): Insight[] {
  const out: Insight[] = [];
  const t = totals(r);
  const cacMedio = t.cac;

  // Investimento mínimo para um alerta de campanha valer a pena: 5% da mídia
  // do período ou R$ 300, o que for maior. Abaixo disso é ruído.
  const piso = Math.max(300, t.mediaSpend * 0.05);

  for (const c of r.campaigns) {
    const nome = c.campaign_name ?? c.campaign_key;
    if (c.spend >= piso && c.leads === 0) {
      out.push({
        id: `camp-sem-lead-${c.campaign_key}`,
        level: 'critical',
        title: `"${nome}" gastou ${fmt(c.spend)} e nenhum lead chegou ao CRM`,
        detail:
          c.meta_leads > 0
            ? `A Meta contou ${c.meta_leads} leads. O formulário ou a landing dessa campanha não está entregando no CRM.`
            : 'Nem a Meta contou leads. Ou o objetivo da campanha não é lead, ou ela não está convertendo.',
      });
      continue;
    }
    if (
      c.spend >= piso &&
      c.sales === 0 &&
      cacMedio != null &&
      c.spend > cacMedio
    ) {
      out.push({
        id: `camp-sem-venda-${c.campaign_key}`,
        level: 'warning',
        title: `"${nome}" já gastou ${fmt(c.spend)} sem nenhuma venda`,
        detail: `É mais que o custo médio de uma venda na conta (${fmt(cacMedio)}), com ${c.leads} leads no CRM.`,
      });
    }
    if (c.meta_leads >= 10 && c.leads < c.meta_leads * 0.7 && c.leads > 0) {
      out.push({
        id: `camp-vaza-${c.campaign_key}`,
        level: 'warning',
        title: `"${nome}": a Meta contou ${c.meta_leads} leads, o CRM recebeu ${c.leads}`,
        detail: `${Math.round((1 - c.leads / c.meta_leads) * 100)}% dos leads não viraram negócio no CRM. Vale conferir a integração do formulário.`,
      });
    }
  }

  for (const ch of r.channels) {
    if (!ch.channel_id) continue;
    const m = rowMetrics(ch);
    if (ch.spend >= piso && m.roas != null && m.roas < 1) {
      out.push({
        id: `canal-prejuizo-${ch.channel_id}`,
        level: ch.sales === 0 ? 'critical' : 'warning',
        title: `${ch.name}: cada R$ 1 investido voltou R$ ${m.roas.toFixed(2).replace('.', ',')}`,
        detail: `${fmt(ch.spend)} investidos, ${fmt(ch.revenue)} de receita em ${ch.sales} ${ch.sales === 1 ? 'venda' : 'vendas'} no período.`,
      });
    }
  }

  // Melhor canal por ROAS (com investimento e venda): o que funciona também é leitura.
  const comRoas = r.channels
    .filter((c) => c.channel_id && c.spend > 0 && c.sales > 0)
    .map((c) => ({ c, roas: rowMetrics(c).roas ?? 0 }))
    .sort((a, b) => b.roas - a.roas);
  if (comRoas.length >= 2 && comRoas[0].roas >= 1) {
    const { c, roas } = comRoas[0];
    out.push({
      id: `canal-melhor-${c.channel_id}`,
      level: 'info',
      title: `${c.name} é o canal que mais devolve: ${roas.toFixed(2).replace('.', ',')}× o investimento`,
      detail: `${c.sales} ${c.sales === 1 ? 'venda' : 'vendas'}, custo de ${fmt(rowMetrics(c).cac ?? 0)} por venda.`,
    });
  }

  // Venda vindo de canal sem custo lançado: o CAC dele está escondido.
  for (const ch of r.channels) {
    if (ch.channel_id && ch.sales > 0 && ch.spend <= 0) {
      out.push({
        id: `canal-sem-custo-${ch.channel_id}`,
        level: 'info',
        title: `${ch.name} trouxe ${ch.sales} ${ch.sales === 1 ? 'venda' : 'vendas'} sem nenhum custo lançado`,
        detail:
          'Lance o custo do time ou do evento desse canal para saber quanto custa cada venda dele.',
      });
    }
  }

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
