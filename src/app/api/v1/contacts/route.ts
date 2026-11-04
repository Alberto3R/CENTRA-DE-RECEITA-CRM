// ============================================================
// GET /api/v1/contacts — contacts changed since a moment, paged by
// `(updated_at, id)` (scope `contacts:read`). See `pagination.ts`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { toApiErrorResponse } from '@/lib/api/v1/respond';
import { finishPage, okPage, pageQuery, parsePageParams } from '@/lib/api/v1/pagination';
import { dbError, e164 } from '@/lib/api/v1/read';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireApiKey(request, 'contacts:read');
    const params = parsePageParams(new URL(request.url), 'updated_since');

    const { data, error } = await pageQuery(
      supabase
        .from('contacts')
        .select('id, name, phone_normalized, wa_user_id, email, company, created_at, updated_at')
        .eq('account_id', accountId),
      'updated_at',
      params
    );
    if (error) throw dbError('contacts', error.message);

    const page = finishPage(data ?? [], params.limit, (r) => r.updated_at as string);
    return okPage(
      page.rows.map((c) => ({
        id: c.id,
        name: c.name ?? null,
        phone: e164(c.phone_normalized as string | null),
        wa_user_id: c.wa_user_id ?? null,
        email: c.email ?? null,
        company: c.company ?? null,
        assigned_to: null,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
      page.next_cursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
