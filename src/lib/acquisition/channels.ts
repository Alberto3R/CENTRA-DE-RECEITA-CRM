// Régua de aquisição por conta (migration 112): canais e classificação.
//
// Um toque (linha da lead_attribution) e/ou um negócio cai no PRIMEIRO canal,
// por `position`, cuja regra bate. Nenhum bateu → "Não identificado".
// A mesma regra roda no SQL do relatório (F3); este é o espelho em TS usado
// na tela de configuração para mostrar origens que ainda não têm canal.

export type ChannelKind =
  | 'paid'
  | 'organic'
  | 'outbound'
  | 'referral'
  | 'event'
  | 'other';

export const CHANNEL_KINDS: { value: ChannelKind; label: string }[] = [
  { value: 'paid', label: 'Tráfego pago' },
  { value: 'organic', label: 'Orgânico' },
  { value: 'outbound', label: 'Prospecção ativa' },
  { value: 'referral', label: 'Indicação' },
  { value: 'event', label: 'Eventos' },
  { value: 'other', label: 'Outro' },
];

export interface AcquisitionChannel {
  id: string;
  account_id: string;
  name: string;
  kind: ChannelKind;
  color: string | null;
  position: number;
  match_sources: string[];
  match_utm_sources: string[];
  match_utm_mediums: string[];
  match_pipeline_ids: string[];
}

export interface Touch {
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
}

export const UNIDENTIFIED = 'Não identificado';

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

function inList(list: string[], v: string | null | undefined): boolean {
  const n = norm(v);
  return !!n && list.some((x) => norm(x) === n);
}

export function channelMatches(
  ch: AcquisitionChannel,
  touch: Touch | null,
  pipelineId: string | null
): boolean {
  if (touch) {
    if (inList(ch.match_sources, touch.source)) return true;
    if (inList(ch.match_utm_sources, touch.utm_source)) return true;
    if (inList(ch.match_utm_mediums, touch.utm_medium)) return true;
  }
  return !!pipelineId && ch.match_pipeline_ids.includes(pipelineId);
}

/** Canal do toque/negócio, ou null = "Não identificado". */
export function classify(
  channels: AcquisitionChannel[],
  touch: Touch | null,
  pipelineId: string | null = null
): AcquisitionChannel | null {
  const ordered = [...channels].sort((a, b) => a.position - b.position);
  return ordered.find((ch) => channelMatches(ch, touch, pipelineId)) ?? null;
}

/** Rótulo curto de uma origem, para listar "origens sem canal". */
export function touchLabel(t: Touch): string {
  const parts = [t.source, t.utm_source, t.utm_medium].map(
    (v) => v?.trim() || '—'
  );
  return `${parts[0]} · ${parts[1]} · ${parts[2]}`;
}

/**
 * Canais sugeridos para começar. Cobrem as origens que o próprio CRM grava
 * (form/landing, ctwa, leadform, post orgânico, seo:). Canais sem rastro
 * digital (prospecção, eventos, indicação) vêm sem regra: o admin aponta os
 * funis deles.
 */
export function suggestedChannels(): Omit<
  AcquisitionChannel,
  'id' | 'account_id'
>[] {
  const base = {
    color: null,
    match_sources: [],
    match_utm_sources: [],
    match_utm_mediums: [],
    match_pipeline_ids: [],
  };
  return [
    {
      ...base,
      // Formulário, landing, formulário nativo e Click-to-WhatsApp juntos: a
      // Meta não separa o gasto entre eles dentro da mesma conta de anúncio.
      name: 'Meta Ads',
      kind: 'paid',
      position: 0,
      match_sources: ['ctwa'],
      match_utm_sources: [
        'fb',
        'ig',
        'facebook',
        'instagram',
        'meta',
        'an',
        'msg',
      ],
      match_utm_mediums: ['paid', 'cpc', 'leadform', 'ctwa'],
    },
    {
      ...base,
      name: 'Orgânico',
      kind: 'organic',
      position: 1,
      match_sources: ['whatsapp-post', 'instagram', 'bio'],
      match_utm_mediums: ['organic', 'social', 'bio'],
    },
    { ...base, name: 'Prospecção ativa', kind: 'outbound', position: 2 },
    {
      ...base,
      name: 'Indicação',
      kind: 'referral',
      position: 3,
      match_sources: ['indicacao', 'indicação'],
    },
    { ...base, name: 'Eventos', kind: 'event', position: 4 },
  ];
}

/** "a, b ,c" → ['a','b','c'] (sem vazios nem repetidos). */
export function parseList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}
