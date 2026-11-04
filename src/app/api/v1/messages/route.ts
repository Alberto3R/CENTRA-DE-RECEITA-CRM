// ============================================================
// GET /api/v1/messages — messages created since a moment, paged by
// `(created_at, id)` (scope `messages:read`). Optional
// `conversation_id` narrows to one thread. Messages carry no account
// column, so the account is enforced through the conversation join.
// `direction` is `in` for the customer, `out` for everyone else;
// `sender_id` is a member id when a person sent it.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { finishPage, okPage, pageQuery, parsePageParams } from '@/lib/api/v1/pagination';
import { dbError } from '@/lib/api/v1/read';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireApiKey(request, 'messages:read');
    const url = new URL(request.url);
    const params = parsePageParams(url, 'created_since');
    const conversationId = url.searchParams.get('conversation_id');
    if (conversationId !== null && !UUID_RE.test(conversationId)) {
      throw badRequest("'conversation_id' must be a UUID");
    }

    let q = supabase
      .from('messages')
      .select(
        'id, conversation_id, sender_type, sender_id, content_type, content_text, template_name, message_id, status, origin, created_at, conversations!inner(account_id)'
      )
      .eq('conversations.account_id', accountId);
    if (conversationId) q = q.eq('conversation_id', conversationId);

    const { data, error } = await pageQuery(q, 'created_at', params);
    if (error) throw dbError('messages', error.message);

    const page = finishPage(data ?? [], params.limit, (r) => r.created_at as string);
    return okPage(
      page.rows.map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        direction: m.sender_type === 'customer' ? 'in' : 'out',
        sender_type: m.sender_type,
        sender_id: m.sender_id ?? null,
        type: m.content_type,
        text: m.content_text ?? (m.template_name ? `[modelo: ${m.template_name}]` : null),
        wa_message_id: m.message_id ?? null,
        status: m.status,
        origin: m.origin ?? null,
        created_at: m.created_at,
      })),
      page.next_cursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
