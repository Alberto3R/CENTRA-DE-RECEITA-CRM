import { describe, expect, it } from 'vitest';

import {
  MAX_LIMIT,
  afterFilter,
  decodeCursor,
  encodeCursor,
  finishPage,
  parsePageParams,
} from './pagination';
import { ApiError } from './respond';

const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const url = (q: string) => new URL(`https://x.test/api/v1/deals?${q}`);

describe('parsePageParams', () => {
  it('defaults: no since, no cursor, limit 200', () => {
    expect(parsePageParams(url(''), 'updated_since')).toEqual({ since: null, after: null, limit: 200 });
  });

  it('caps the limit and normalises since', () => {
    const p = parsePageParams(url('limit=9999&updated_since=2026-11-04T10:00:00-03:00'), 'updated_since');
    expect(p.limit).toBe(MAX_LIMIT);
    expect(p.since).toBe('2026-11-04T13:00:00.000Z');
  });

  it('rejects bad input with bad_request', () => {
    for (const q of ['limit=0', 'limit=abc', 'updated_since=ontem', 'cursor=lixo']) {
      expect(() => parsePageParams(url(q), 'updated_since')).toThrow(ApiError);
    }
  });
});

describe('cursor', () => {
  it('round-trips and keeps microseconds', () => {
    const t = '2026-11-04T13:00:00.123456+00:00';
    expect(decodeCursor(encodeCursor(t, ID))).toEqual({ t, id: ID });
  });

  it('refuses a cursor whose id is not a uuid', () => {
    expect(() => decodeCursor(encodeCursor('2026-11-04T13:00:00Z', '1 or 1=1'))).toThrow(ApiError);
  });

  it('builds the strictly-after filter', () => {
    expect(afterFilter('updated_at', { t: '2026-11-04T13:00:00Z', id: ID })).toBe(
      `updated_at.gt."2026-11-04T13:00:00Z",and(updated_at.eq."2026-11-04T13:00:00Z",id.gt.${ID})`
    );
  });
});

describe('finishPage', () => {
  const rows = [1, 2, 3].map((n) => ({ id: `${ID.slice(0, -1)}${n}`, t: `2026-11-04T13:00:0${n}Z` }));

  it('last page has no cursor', () => {
    expect(finishPage(rows, 3, (r) => r.t)).toEqual({ rows, next_cursor: null });
  });

  it('trims the extra row and points the cursor at the last kept row', () => {
    const p = finishPage(rows, 2, (r) => r.t);
    expect(p.rows).toHaveLength(2);
    expect(decodeCursor(p.next_cursor!)).toEqual({ t: rows[1].t, id: rows[1].id });
  });
});
