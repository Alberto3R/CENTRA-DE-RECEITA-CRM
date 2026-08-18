import { uploadResumableMedia } from '@/lib/whatsapp/meta-api';
import { isMetaHandleUrl } from '@/lib/whatsapp/media-url';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload
 * API) to create/edit a template with an IMAGE, VIDEO or DOCUMENT
 * header — a plain public URL is not accepted at creation time. This
 * helper turns the template's `header_media_url` (whether the user
 * uploaded a file or pasted a link) into a handle and writes it onto
 * the payload, so both the upload path and the legacy URL path
 * actually succeed.
 *
 * No-op unless the header is a media header that has a URL but no
 * handle yet.
 *
 * IMPORTANT: the handle produced here is a CREATION-TIME sample only.
 * It is not a send-time media reference — see `template-send-builder`,
 * which deliberately refuses to reuse it. A template whose media only
 * ever existed as a handle (e.g. created in Meta's own UI and synced
 * back) has no sendable media, and every send of it dies silently:
 * Meta accepts the POST, fails to fetch the media, and never delivers.
 * That is exactly why we always keep a real `header_media_url`.
 */

/** Meta's per-kind sample limits (document is held at our bucket cap). */
const MEDIA_RULES = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    maxLabel: '5 MB',
    types: ['image/jpeg', 'image/png'],
    label: 'JPEG or PNG',
    fileNameByType: { 'image/png': 'header.png', 'image/jpeg': 'header.jpg' },
    defaultType: 'image/jpeg',
  },
  video: {
    maxBytes: 16 * 1024 * 1024,
    maxLabel: '16 MB',
    types: ['video/mp4', 'video/3gpp'],
    label: 'MP4 or 3GPP',
    fileNameByType: { 'video/3gpp': 'header.3gp', 'video/mp4': 'header.mp4' },
    defaultType: 'video/mp4',
  },
  document: {
    maxBytes: 16 * 1024 * 1024,
    maxLabel: '16 MB',
    types: ['application/pdf'],
    label: 'PDF',
    fileNameByType: { 'application/pdf': 'header.pdf' },
    defaultType: 'application/pdf',
  },
} as const;

type MediaHeaderType = keyof typeof MEDIA_RULES;

function isMediaHeaderType(t: string | undefined): t is MediaHeaderType {
  return t === 'image' || t === 'video' || t === 'document';
}

export async function ensureMediaHeaderHandle(
  payload: TemplatePayload,
  accessToken: string
): Promise<void> {
  const headerType = payload.header_type;
  if (!isMediaHeaderType(headerType)) return;
  if (payload.header_handle) return; // already have one
  if (!payload.header_media_url) return; // validator already requires url-or-handle

  const rules = MEDIA_RULES[headerType];

  // A Meta CDN handle URL is not fetchable media — refuse it here so the
  // template can't be created with media that will never deliver.
  if (isMetaHandleUrl(payload.header_media_url)) {
    throw new Error(
      'This URL is a Meta upload handle, not a media file. Upload the file itself so it can be sent with every message.'
    );
  }

  const appId = process.env.META_APP_ID;
  if (!appId) {
    throw new Error(
      `${headerType}-header templates need META_APP_ID set (used for Meta’s Resumable Upload). Add it to your environment, or remove the ${headerType} header.`
    );
  }

  // Fetch the sample bytes (works for our uploaded chat-media URL and
  // for a manually-pasted public link).
  let res: Response;
  try {
    res = await fetch(payload.header_media_url);
  } catch {
    throw new Error(
      `Could not fetch the header ${headerType} URL. Make sure it is publicly reachable.`
    );
  }
  if (!res.ok) {
    throw new Error(
      `Header ${headerType} URL returned ${res.status}. It must be publicly reachable.`
    );
  }

  const contentType = (res.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const allowed = rules.types as readonly string[];
  if (contentType && !allowed.includes(contentType)) {
    throw new Error(
      `Header ${headerType} must be ${rules.label} (got ${contentType}).`
    );
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error(`Header ${headerType} is empty.`);
  }
  if (bytes.byteLength > rules.maxBytes) {
    throw new Error(
      `Header ${headerType} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — Meta's limit is ${rules.maxLabel}.`
    );
  }

  const mimeType = allowed.includes(contentType)
    ? contentType
    : rules.defaultType;
  const names = rules.fileNameByType as Record<string, string>;
  const fileName = names[mimeType] ?? names[rules.defaultType];

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName,
    mimeType,
    bytes,
  });
  payload.header_handle = handle;
}
