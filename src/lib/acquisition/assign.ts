// Configuração de canais "pela origem" (tela de Aquisição).
//
// Quem configura não pensa em source/utm_source/utm_medium: pensa "esse lead
// que veio do formulário pelo Instagram é Meta Ads". Então a tela mostra as
// ORIGENS reais da conta em português e um menu de canal para cada uma; aqui
// a escolha vira as regras (match_*) que o relatório já entende.

import { classify, type AcquisitionChannel, type Touch } from './channels';

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

const SOURCE_LABEL: [RegExp, string][] = [
  [/^ctwa$/, 'Anúncio que abre o WhatsApp'],
  [/^whatsapp-post$/, 'Post com botão de WhatsApp'],
  [/^meta-leadform/, 'Formulário dentro do Facebook/Instagram'],
  [/^form$/, 'Formulário do site'],
  [/^landing/, 'Página de captura'],
  [/^funil2-landing$/, 'Página de captura'],
  [/^seo:/, 'Google (busca orgânica)'],
  [/^teste$/, 'Teste'],
];

const UTM_SOURCE_LABEL: Record<string, string> = {
  fb: 'Facebook',
  facebook: 'Facebook',
  ig: 'Instagram',
  instagram: 'Instagram',
  an: 'Rede de parceiros da Meta',
  msg: 'Messenger',
  meta: 'Meta',
  google: 'Google',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
};

const UTM_MEDIUM_LABEL: Record<string, string> = {
  paid: 'anúncio',
  cpc: 'anúncio',
  ctwa: 'anúncio',
  leadform: 'anúncio',
  organic: 'orgânico',
  social: 'orgânico',
  bio: 'link da bio',
  email: 'e-mail',
};

/** Origem em português: "Formulário do site · Instagram (anúncio)". */
export function originLabel(t: Touch): string {
  const s = norm(t.source);
  const base =
    SOURCE_LABEL.find(([re]) => re.test(s))?.[1] ??
    (t.source?.trim() || 'Origem não informada');
  const us = norm(t.utm_source);
  const um = norm(t.utm_medium);
  const de = us ? (UTM_SOURCE_LABEL[us] ?? t.utm_source!.trim()) : '';
  const como = um ? (UTM_MEDIUM_LABEL[um] ?? t.utm_medium!.trim()) : '';
  const resto = [de, como && (de ? `(${como})` : como)]
    .filter(Boolean)
    .join(' ');
  return resto ? `${base} · ${resto}` : base;
}

/** Detalhe técnico, para quem quiser conferir (mostrado em cinza). */
export function originTech(t: Touch): string {
  return [t.source, t.utm_source, t.utm_medium]
    .map((v) => v?.trim() || '—')
    .join(' · ');
}

type Field = 'match_sources' | 'match_utm_sources' | 'match_utm_mediums';
const FIELDS: { field: Field; key: keyof Touch }[] = [
  { field: 'match_utm_sources', key: 'utm_source' },
  { field: 'match_sources', key: 'source' },
  { field: 'match_utm_mediums', key: 'utm_medium' },
];

const without = (list: string[], v: string) =>
  list.filter((x) => norm(x) !== norm(v));

/**
 * Faz a origem `t` cair no canal `targetId` (ou em "Não identificado" se
 * null). Devolve a lista nova de canais. Estratégia: usa o valor mais
 * específico da origem (utm_source > source > utm_medium) como regra do canal
 * escolhido e o tira dos outros; se outra regra de canal com prioridade maior
 * ainda captura a origem, tira também o valor que casou lá.
 */
export function assignOrigin(
  channels: AcquisitionChannel[],
  t: Touch,
  targetId: string | null
): AcquisitionChannel[] {
  let next = channels.map((c) => ({ ...c }));
  const valores = FIELDS.map((f) => ({
    ...f,
    v: (t[f.key] ?? '').trim(),
  })).filter((f) => f.v);

  if (targetId === null) {
    for (const f of valores)
      next = next.map((c) => ({ ...c, [f.field]: without(c[f.field], f.v) }));
    return next;
  }

  const chave = valores[0];
  if (!chave) return next;
  next = next.map((c) => {
    const limpo = without(c[chave.field], chave.v);
    return {
      ...c,
      [chave.field]: c.id === targetId ? [...limpo, chave.v] : limpo,
    };
  });

  // Outro canal mais acima ainda pega essa origem por outro campo? Solta lá.
  for (let i = 0; i < 3; i++) {
    const atual = classify(next, t);
    if (!atual || atual.id === targetId) break;
    next = next.map((c) =>
      c.id !== atual.id
        ? c
        : valores.reduce(
            (acc, f) => ({ ...acc, [f.field]: without(acc[f.field], f.v) }),
            c
          )
    );
  }
  return next;
}

/** Funil inteiro conta como um canal (ou volta a valer a origem, se null). */
export function assignPipeline(
  channels: AcquisitionChannel[],
  pipelineId: string,
  targetId: string | null
): AcquisitionChannel[] {
  return channels.map((c) => {
    const limpo = c.match_pipeline_ids.filter((p) => p !== pipelineId);
    return {
      ...c,
      match_pipeline_ids: c.id === targetId ? [...limpo, pipelineId] : limpo,
    };
  });
}

/** Canais que mudaram (para salvar só eles). */
export function changedChannels(
  before: AcquisitionChannel[],
  after: AcquisitionChannel[]
): AcquisitionChannel[] {
  const key = (c: AcquisitionChannel) =>
    JSON.stringify([
      c.match_sources,
      c.match_utm_sources,
      c.match_utm_mediums,
      c.match_pipeline_ids,
    ]);
  const antes = new Map(before.map((c) => [c.id, key(c)]));
  return after.filter((c) => antes.get(c.id) !== key(c));
}
