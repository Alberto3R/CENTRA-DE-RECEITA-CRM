/**
 * Meta hands back two very different things that both look like URLs,
 * and confusing them is what silently kills template deliveries:
 *
 *   - a MEDIA URL: a file we (or the customer) host, which Meta fetches
 *     on every single send;
 *   - a HANDLE URL: what the Resumable Upload API / the Meta template
 *     editor returns as the creation-time `example.header_handle`. It
 *     points at Meta's own CDN, carries a short-lived signature, and is
 *     NOT fetchable by Meta's sender.
 *
 * Pasting a handle into a media field is the natural mistake — the
 * template looks perfect and gets approved, then Meta accepts every
 * send (each one gets a message id) and delivers none of them. There is
 * no error on the response and, for most sends, no failed webhook
 * either: the message just never arrives.
 *
 * So we reject handle URLs at every point where a media URL is expected.
 */

/** Hosts Meta uses for upload handles / internal CDN objects. */
const HANDLE_HOSTS = [
  /(^|\.)whatsapp\.net$/i,
  /(^|\.)lookaside\.[a-z0-9-]+\.[a-z]+$/i,
];

export function isMetaHandleUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  let host: string;
  try {
    host = new URL(value.trim()).hostname;
  } catch {
    return false;
  }
  return HANDLE_HOSTS.some((re) => re.test(host));
}

/** User-facing explanation, shared by the API and the UI. */
export const META_HANDLE_URL_MESSAGE =
  'Esse link é um identificador de upload da Meta, não o arquivo de mídia. Envie o arquivo aqui para que ele siga junto em cada mensagem.';
