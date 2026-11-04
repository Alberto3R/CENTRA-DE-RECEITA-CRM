// ============================================================
// GET /api/v1/pipelines — funnels with their stages, in order
// (scope `pipelines:read`). `funcao` is the fixed stage function the
// metrics use; `max_days` is the stage's "stalled" threshold.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { dbError } from '@/lib/api/v1/read';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireApiKey(request, 'pipelines:read');

    const { data: pipelines, error } = await supabase
      .from('pipelines')
      .select('id, name, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });
    if (error) throw dbError('pipelines', error.message);

    const ids = (pipelines ?? []).map((p) => p.id as string);
    const { data: stages, error: e2 } = ids.length
      ? await supabase
          .from('pipeline_stages')
          .select('id, pipeline_id, name, position, color, funcao, dias_max')
          .in('pipeline_id', ids)
          .order('position', { ascending: true })
      : { data: [], error: null };
    if (e2) throw dbError('pipelines', e2.message);

    return ok(
      (pipelines ?? []).map((p, i) => ({
        id: p.id,
        name: p.name,
        position: i,
        stages: (stages ?? [])
          .filter((s) => s.pipeline_id === p.id)
          .map((s) => ({
            id: s.id,
            name: s.name,
            position: s.position,
            funcao: s.funcao ?? null,
            color: s.color ?? null,
            max_days: s.dias_max ?? null,
          })),
      }))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
