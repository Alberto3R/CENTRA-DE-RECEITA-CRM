// ============================================================
// GET /api/v1/members — the account's team (scope `members:read`).
//
// `id` is the member's auth user id (the id every other endpoint uses
// for `assigned_to` / `sender_id`). `whatsapp` comes from the seller
// record linked to the login, when there is one. Small list: no paging.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { dbError, e164 } from '@/lib/api/v1/read';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireApiKey(request, 'members:read');

    const { data: members, error } = await supabase
      .from('account_members')
      .select('user_id, role')
      .eq('account_id', accountId);
    if (error) throw dbError('members', error.message);

    const userIds = (members ?? []).map((m) => m.user_id as string);
    const [profiles, sellers] = await Promise.all([
      userIds.length
        ? supabase.from('profiles').select('id, user_id, full_name, email').in('user_id', userIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('sellers').select('linked_user_id, whatsapp, funcao').eq('account_id', accountId),
    ]);
    if (profiles.error) throw dbError('members', profiles.error.message);
    if (sellers.error) throw dbError('members', sellers.error.message);

    const profileByUser = new Map((profiles.data ?? []).map((p) => [p.user_id as string, p]));
    const sellerByUser = new Map(
      (sellers.data ?? []).filter((s) => s.linked_user_id).map((s) => [s.linked_user_id as string, s])
    );

    return ok(
      (members ?? []).map((m) => {
        const p = profileByUser.get(m.user_id as string);
        const s = sellerByUser.get(m.user_id as string);
        return {
          id: m.user_id,
          profile_id: p?.id ?? null,
          name: p?.full_name ?? null,
          email: p?.email ?? null,
          role: m.role,
          funcao: s?.funcao ?? null,
          whatsapp: e164(s?.whatsapp as string | null | undefined),
          active: true,
        };
      })
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
