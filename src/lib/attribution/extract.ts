// Extrai a atribuição (de onde o lead veio) do payload de um formulário.
//
// Ordem de confiança: o que a landing mandou no corpo > o que está na query
// string da página (landing_url / event_source_url) > o Referer do POST.
// Assim um formulário que só manda nome/e-mail/telefone ainda grava a origem
// se mandar (ou o navegador expuser) a URL da página.

export interface Attribution {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
  ad_id: string | null;
  landing_url: string | null;
}

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim()
    ? v.trim()
    : typeof v === 'number'
      ? String(v)
      : null;
}

function queryOf(url: string | null): URLSearchParams | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
}

export function extractAttribution(
  body: Record<string, unknown>,
  referer?: string | null
): Attribution {
  const landing =
    str(body.event_source_url) ?? str(body.landing_url) ?? str(referer) ?? null;
  const q = queryOf(landing);
  const pick = (k: string) => str(body[k]) ?? (q ? str(q.get(k)) : null);

  const out = {} as Attribution;
  for (const k of UTM_KEYS) out[k] = pick(k);
  out.fbclid = pick('fbclid');
  out.fbp = str(body.fbp);
  out.fbc = str(body.fbc);
  out.ad_id = pick('ad_id');
  out.landing_url = landing;
  return out;
}
