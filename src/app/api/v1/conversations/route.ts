// ============================================================
// GET /api/v1/conversations — conversations changed since a moment,
// paged by `(updated_at, id)` (scope `conversations:read`). A new
// message bumps the conversation, so this is also the cheap way to
// learn which threads have new messages. `channel` is whatsapp,
// instagram or email (null channel = the account's primary WhatsApp).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { toApiErrorResponse } from '@/lib/api/v1/respond';
import { finishPage, okPage, pageQuery, parsePageParams } from '@/lib/api/v1/pagination';
import { dbError } from '@/lib/api/v1/read';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireApiKey(request, 'conversations:read');
    const params = parsePageParams(new URL(request.url), 'updated_since');

    const [convs, channels] = await Promise.all([
      pageQuery(
        supabase
          .from('conversations')
          .select('id, contact_id, status, assigned_agent_id, channel_id, last_message_at, created_at, updated_at')
          .eq('account_id', accountId),
        'updated_at',
        params
      ),
      supabase.from('whatsapp_config').select('id, channel_type').eq('account_id', accountId),
    ]);
    if (convs.error) throw dbError('conversations', convs.error.message);
    if (channels.error) throw dbError('conversations', channels.error.message);

    const typeById = new Map((channels.data ?? []).map((c) => [c.id as string, c.channel_type as string]));
    const page = finishPage(convs.data ?? [], params.limit, (r) => r.updated_at as string);

    return okPage(
      page.rows.map((c) => ({
        id: c.id,
        contact_id: c.contact_id,
        channel: c.channel_id ? (typeById.get(c.channel_id as string) ?? 'whatsapp') : 'whatsapp',
        channel_id: c.channel_id ?? null,
        status: c.status,
        assigned_to: c.assigned_agent_id ?? null,
        last_message_at: c.last_message_at ?? null,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
      page.next_cursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
