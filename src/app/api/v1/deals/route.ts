// ============================================================
// GET /api/v1/deals — deals changed since a moment, paged by
// `(updated_at, id)` (scope `deals:read`). `value` is in the deal's
// currency units (not cents). `assigned_to` is a member id
// (`GET /api/v1/members`). There is no next-action field here yet:
// `next_action` / `next_action_at` are always null.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { toApiErrorResponse } from '@/lib/api/v1/respond';
import { finishPage, okPage, pageQuery, parsePageParams } from '@/lib/api/v1/pagination';
import { dbError, userIdsByProfileId } from '@/lib/api/v1/read';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireApiKey(request, 'deals:read');
    const params = parsePageParams(new URL(request.url), 'updated_since');

    const { data, error } = await pageQuery(
      supabase
        .from('deals')
        .select(
          'id, title, contact_id, pipeline_id, stage_id, status, value, currency, assigned_to, expected_close_date, stage_entered_at, closed_at, lost_reason, created_at, updated_at'
        )
        .eq('account_id', accountId),
      'updated_at',
      params
    );
    if (error) throw dbError('deals', error.message);

    const page = finishPage(data ?? [], params.limit, (r) => r.updated_at as string);
    const users = await userIdsByProfileId(
      supabase,
      page.rows.map((d) => d.assigned_to as string)
    );

    return okPage(
      page.rows.map((d) => ({
        id: d.id,
        title: d.title,
        contact_id: d.contact_id ?? null,
        pipeline_id: d.pipeline_id,
        stage_id: d.stage_id,
        status: d.status === 'won' || d.status === 'lost' ? d.status : 'active',
        value: Number(d.value ?? 0),
        currency: d.currency ?? null,
        assigned_to: d.assigned_to ? (users.get(d.assigned_to as string) ?? null) : null,
        expected_close_date: d.expected_close_date ?? null,
        stage_entered_at: d.stage_entered_at ?? null,
        closed_at: d.closed_at ?? null,
        lost_reason: d.lost_reason ?? null,
        next_action: null,
        next_action_at: null,
        created_at: d.created_at,
        updated_at: d.updated_at,
      })),
      page.next_cursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
