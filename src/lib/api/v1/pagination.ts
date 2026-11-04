// ============================================================
// Public API (v1) keyset pagination for the read endpoints.
//
// Every list endpoint pages in ascending `(<time column>, id)` order
// — `updated_at` for mutable rows, `created_at` for messages — so a
// caller that syncs incrementally just remembers the last cursor (or
// the newest timestamp it saw) and asks again. Keyset instead of
// OFFSET: stable under concurrent writes and cheap on large tables.
//
// The cursor is opaque to callers (base64url JSON of the last row's
// time + id). A row edited mid-sync can show up twice (its time moved
// past the cursor); callers dedupe by id, as documented.
// ============================================================

import { NextResponse } from 'next/server';

import { badRequest } from './respond';

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

export interface PageParams {
  /** Inclusive lower bound on the time column (ISO), or null. */
  since: string | null;
  /** Last row of the previous page, or null for the first page. */
  after: { t: string; id: string } | null;
  limit: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isoOrThrow(value: string, name: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw badRequest(`'${name}' must be an ISO 8601 timestamp`);
  return new Date(ms).toISOString();
}

export function encodeCursor(t: string, id: string): string {
  return Buffer.from(JSON.stringify({ t, id })).toString('base64url');
}

export function decodeCursor(cursor: string): { t: string; id: string } {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof raw?.t === 'string' && typeof raw?.id === 'string' && UUID_RE.test(raw.id)) {
      // keep the database's own timestamp text: it has microseconds,
      // and rounding it to JS milliseconds would skip or repeat rows
      isoOrThrow(raw.t, 'cursor');
      if (/^[0-9T:.+\- Z]{10,40}$/.test(raw.t)) return { t: raw.t, id: raw.id };
    }
  } catch {
    // fall through
  }
  throw badRequest("'cursor' is not valid");
}

/**
 * Read `<sinceParam>`, `cursor` and `limit` from the query string.
 * Throws `bad_request` on malformed input.
 */
export function parsePageParams(url: URL, sinceParam: 'updated_since' | 'created_since'): PageParams {
  const sinceRaw = url.searchParams.get(sinceParam);
  const cursorRaw = url.searchParams.get('cursor');
  const limitRaw = url.searchParams.get('limit');

  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1) throw badRequest("'limit' must be a positive integer");
    limit = Math.min(n, MAX_LIMIT);
  }

  return {
    since: sinceRaw ? isoOrThrow(sinceRaw, sinceParam) : null,
    after: cursorRaw ? decodeCursor(cursorRaw) : null,
    limit,
  };
}

/**
 * PostgREST `or` filter for "strictly after (t, id)" in `(col, id)`
 * order. Timestamps are quoted because they contain `:` and `.`.
 */
export function afterFilter(col: string, after: { t: string; id: string }): string {
  return `${col}.gt."${after.t}",and(${col}.eq."${after.t}",id.gt.${after.id})`;
}

/**
 * Given the page fetched with `limit + 1` rows, trim it and compute
 * the next cursor (null when this is the last page).
 */
export function finishPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  timeOf: (row: T) => string
): { rows: T[]; next_cursor: string | null } {
  if (rows.length <= limit) return { rows, next_cursor: null };
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, next_cursor: encodeCursor(timeOf(last), last.id) };
}

/** Success envelope for a list page: `{ data: [...], next_cursor }`. */
export function okPage<T>(data: T[], next_cursor: string | null): NextResponse {
  return NextResponse.json({ data, next_cursor });
}

// The subset of the PostgREST builder the helper needs. Typed loosely on
// purpose: the generated builder generics don't survive being passed around.
interface Filterable<Q> {
  gte(col: string, v: string): Q;
  or(filter: string): Q;
  order(col: string, opts: { ascending: boolean }): Q;
  limit(n: number): Q;
}

/**
 * Apply `since`, the keyset `after`, the `(col, id)` order and a
 * `limit + 1` fetch (the extra row tells `finishPage` there is more).
 */
export function pageQuery<Q extends Filterable<Q>>(q: Q, col: string, p: PageParams): Q {
  let out = q;
  if (p.since) out = out.gte(col, p.since);
  if (p.after) out = out.or(afterFilter(col, p.after));
  return out.order(col, { ascending: true }).order('id', { ascending: true }).limit(p.limit + 1);
}
