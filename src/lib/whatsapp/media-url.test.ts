import { describe, expect, it } from 'vitest';
import { isMetaHandleUrl } from './media-url';

describe('isMetaHandleUrl', () => {
  it('flags the scontent.whatsapp.net handle Meta hands back on upload', () => {
    expect(
      isMetaHandleUrl(
        'https://scontent.whatsapp.net/v/t61.29466-34/684152135_1039226272335144_n.mp4?ccb=1-7&oe=6AABDA8A'
      )
    ).toBe(true);
  });

  it('flags lookaside hosts', () => {
    expect(
      isMetaHandleUrl(
        'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1'
      )
    ).toBe(true);
  });

  it('passes a real public media URL', () => {
    expect(
      isMetaHandleUrl('https://cdn.sales3r.com.br/account-1/convite.mp4')
    ).toBe(false);
  });

  it('passes a Supabase Storage public URL', () => {
    expect(
      isMetaHandleUrl(
        'https://uymmbqockiqcpporluxk.supabase.co/storage/v1/object/public/chat-media/account-1/1-v.mp4'
      )
    ).toBe(false);
  });

  it('is false for empty or malformed values', () => {
    expect(isMetaHandleUrl('')).toBe(false);
    expect(isMetaHandleUrl(null)).toBe(false);
    expect(isMetaHandleUrl('not a url')).toBe(false);
  });
});
