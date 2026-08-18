import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the Meta resumable upload so the helper is tested in isolation.
vi.mock('./meta-api', () => ({
  uploadResumableMedia: vi.fn(async () => ({ handle: 'HANDLE123' })),
}));

import { ensureMediaHeaderHandle } from './template-header-handle';
import { uploadResumableMedia } from './meta-api';
import type { TemplatePayload } from './template-validators';

function payload(over: Partial<TemplatePayload> = {}): TemplatePayload {
  return {
    name: 't',
    category: 'Utility',
    language: 'en_US',
    body_text: 'hi',
    header_type: 'image',
    header_media_url: 'https://x.test/img.jpg',
    ...over,
  };
}

function imgResponse(
  type = 'image/jpeg',
  size = 1024,
  ok = true,
  status = 200
): Response {
  return {
    ok,
    status,
    headers: {
      get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null),
    },
    arrayBuffer: async () => new ArrayBuffer(size),
  } as unknown as Response;
}

describe('ensureMediaHeaderHandle', () => {
  beforeEach(() => {
    vi.mocked(uploadResumableMedia).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is a no-op for non-media headers', async () => {
    const p = payload({ header_type: 'text', header_content: 'Hi' });
    await ensureMediaHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).not.toHaveBeenCalled();
    expect(p.header_handle).toBeUndefined();
  });

  it('is a no-op when a handle already exists', async () => {
    const p = payload({ header_handle: 'existing' });
    await ensureMediaHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).not.toHaveBeenCalled();
    expect(p.header_handle).toBe('existing');
  });

  it('throws an actionable error when META_APP_ID is unset', async () => {
    const p = payload();
    await expect(ensureMediaHeaderHandle(p, 'tok')).rejects.toThrow(
      /META_APP_ID/
    );
  });

  it('derives + sets header_handle from a valid image URL', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('image/jpeg', 2048))
    );
    const p = payload();
    await ensureMediaHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).toHaveBeenCalledOnce();
    expect(p.header_handle).toBe('HANDLE123');
  });

  it('rejects a non-image content type', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('text/html'))
    );
    await expect(ensureMediaHeaderHandle(payload(), 'tok')).rejects.toThrow(
      /JPEG or PNG/
    );
  });

  it('rejects an image over 5 MB', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('image/png', 6 * 1024 * 1024))
    );
    await expect(ensureMediaHeaderHandle(payload(), 'tok')).rejects.toThrow(
      /5 MB/
    );
  });

  // Video headers are what the EQV "Convite Aula" broadcast needed: the
  // template was built in Meta's UI, so the CRM only ever had a handle
  // and every send died undelivered.
  it('derives + sets header_handle from a valid video URL', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('video/mp4', 2 * 1024 * 1024))
    );
    const p = payload({
      header_type: 'video',
      header_media_url: 'https://x.test/v.mp4',
    });
    await ensureMediaHeaderHandle(p, 'tok');
    expect(uploadResumableMedia).toHaveBeenCalledOnce();
    expect(p.header_handle).toBe('HANDLE123');
  });

  it('rejects a video over 16 MB', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('video/mp4', 17 * 1024 * 1024))
    );
    const p = payload({
      header_type: 'video',
      header_media_url: 'https://x.test/v.mp4',
    });
    await expect(ensureMediaHeaderHandle(p, 'tok')).rejects.toThrow(/16 MB/);
  });

  it('rejects a non-video content type on a video header', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => imgResponse('text/html'))
    );
    const p = payload({
      header_type: 'video',
      header_media_url: 'https://x.test/v.mp4',
    });
    await expect(ensureMediaHeaderHandle(p, 'tok')).rejects.toThrow(
      /MP4 or 3GPP/
    );
  });

  // The exact failure mode behind the silent broadcast: a Meta CDN
  // handle URL pasted where real media belongs.
  it('refuses a Meta handle URL as media, before any upload', async () => {
    vi.stubEnv('META_APP_ID', 'app-1');
    const p = payload({
      header_type: 'video',
      header_media_url:
        'https://scontent.whatsapp.net/v/t61.29466-34/684152135_1039226272335144_n.mp4?ccb=1-7',
    });
    await expect(ensureMediaHeaderHandle(p, 'tok')).rejects.toThrow(
      /upload handle/i
    );
    expect(uploadResumableMedia).not.toHaveBeenCalled();
  });
});
