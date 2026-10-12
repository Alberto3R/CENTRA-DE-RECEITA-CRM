import { describe, expect, it } from 'vitest';
import { buildInsights } from './insights';
import type { AcquisitionReport, CampaignRow, ChannelRow } from './report';

const fmt = (v: number) => `R$${Math.round(v)}`;

const ch = (o: Partial<ChannelRow>): ChannelRow => ({
  channel_id: 'x',
  name: 'x',
  kind: 'paid',
  position: 0,
  leads: 0,
  sales: 0,
  revenue: 0,
  won_no_value: 0,
  spend: 0,
  media_spend: 0,
  other_cost: 0,
  meta_leads: 0,
  ...o,
});
const camp = (o: Partial<CampaignRow>): CampaignRow => ({
  campaign_key: 'c',
  campaign_name: 'C',
  spend: 0,
  meta_leads: 0,
  leads: 0,
  sales: 0,
  revenue: 0,
  ...o,
});
const rep = (
  channels: ChannelRow[],
  campaigns: CampaignRow[] = []
): AcquisitionReport => ({
  period: { from: '2026-09-01', to: '2026-09-30' },
  currency: 'BRL',
  settings: {
    attribution_model: 'first_touch',
    attribution_window_days: 90,
    margin_pct: null,
    commission_pct: null,
  },
  channels,
  campaigns,
  weekly: [],
  spend_currencies: ['BRL'],
  ad_accounts: [],
});

describe('buildInsights', () => {
  it('campanha com gasto relevante e zero lead no CRM é crítica, citando os leads da Meta', () => {
    const r = rep(
      [
        ch({
          channel_id: 'meta',
          name: 'Meta Ads',
          spend: 5000,
          media_spend: 5000,
          leads: 100,
          sales: 4,
          revenue: 20000,
        }),
      ],
      [
        camp({
          campaign_key: 'k1',
          campaign_name: 'Rotina que Vende',
          spend: 3600,
          meta_leads: 40,
          leads: 0,
        }),
      ]
    );
    const i = buildInsights(r, fmt);
    expect(i[0]).toMatchObject({ level: 'critical', id: 'camp-sem-lead-k1' });
    expect(i[0].detail).toContain('40 leads');
  });

  it('gasto pequeno (abaixo do piso) não vira alerta', () => {
    const r = rep(
      [
        ch({
          channel_id: 'meta',
          spend: 10000,
          media_spend: 10000,
          leads: 100,
          sales: 5,
          revenue: 50000,
        }),
      ],
      [camp({ spend: 200, leads: 0 })]
    );
    expect(
      buildInsights(r, fmt).find((x) => x.id.startsWith('camp-sem-lead'))
    ).toBeUndefined();
  });

  it('campanha que passou do CAC médio sem venda é aviso', () => {
    const r = rep(
      [
        ch({
          channel_id: 'meta',
          spend: 10000,
          media_spend: 10000,
          leads: 200,
          sales: 10,
          revenue: 50000,
        }),
      ],
      [camp({ campaign_key: 'k2', spend: 1500, leads: 30, sales: 0 })]
    );
    expect(buildInsights(r, fmt).map((x) => x.id)).toContain(
      'camp-sem-venda-k2'
    );
  });

  it('vazamento Meta × CRM', () => {
    const r = rep(
      [ch({ channel_id: 'meta', spend: 1000, media_spend: 1000, leads: 10 })],
      [camp({ campaign_key: 'k3', spend: 100, meta_leads: 40, leads: 10 })]
    );
    const v = buildInsights(r, fmt).find((x) => x.id === 'camp-vaza-k3');
    expect(v?.detail).toContain('75%');
  });

  it('canal com ROAS < 1 e canal sem custo lançado', () => {
    const r = rep([
      ch({
        channel_id: 'meta',
        name: 'Meta Ads',
        spend: 9598,
        media_spend: 9598,
        leads: 431,
        sales: 1,
        revenue: 997,
      }),
      ch({
        channel_id: 'out',
        name: 'Prospecção',
        kind: 'outbound',
        leads: 57,
        sales: 7,
        revenue: 5981,
      }),
    ]);
    const ids = buildInsights(r, fmt).map((x) => x.id);
    expect(ids).toContain('canal-prejuizo-meta');
    expect(ids).toContain('canal-sem-custo-out');
    const p = buildInsights(r, fmt).find(
      (x) => x.id === 'canal-prejuizo-meta'
    )!;
    expect(p.title).toContain('R$ 0,10');
  });

  it('ordena crítico → aviso → info', () => {
    const r = rep(
      [
        ch({
          channel_id: 'meta',
          spend: 5000,
          media_spend: 5000,
          leads: 100,
          sales: 0,
          revenue: 0,
        }),
        ch({ channel_id: 'out', leads: 10, sales: 2, revenue: 4000 }),
      ],
      [camp({ spend: 3000, leads: 0 })]
    );
    const levels = buildInsights(r, fmt).map((x) => x.level);
    expect(levels).toEqual(
      [...levels].sort(
        (a, b) =>
          ['critical', 'warning', 'info'].indexOf(a) -
          ['critical', 'warning', 'info'].indexOf(b)
      )
    );
  });
});
