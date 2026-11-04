// ============================================================
// Shared pieces of the public read endpoints (`GET /api/v1/*`).
//
// People are always identified by their auth `user_id` on the wire:
// `deals.assigned_to` stores a `profiles.id`, while conversations and
// messages store the `user_id`. The API speaks one id so callers can
// join everything against `GET /api/v1/members`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from './respond';

/** Wrap a PostgREST error so the route answers 500 without leaking it. */
export function dbError(where: string, message: string): ApiError {
  console.error(`[api/v1/${where}] query error:`, message);
  return new ApiError('internal', 'Internal server error', 500);
}

/** profiles.id → user_id for the given profile ids (one round trip). */
export async function userIdsByProfileId(
  supabase: SupabaseClient,
  profileIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data, error } = await supabase.from('profiles').select('id, user_id').in('id', ids);
  if (error) throw dbError('profiles', error.message);
  for (const p of data ?? []) map.set(p.id as string, p.user_id as string);
  return map;
}

/** Digits-only phone → E.164 with "+", or null. */
export function e164(digits: string | null | undefined): string | null {
  const d = (digits ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}
