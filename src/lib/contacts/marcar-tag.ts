import type { SupabaseClient } from '@supabase/supabase-js'

// Marca um contato com uma tag configurada num webhook (formulário ou
// pagamento). Roda com service role, então confere que a tag é da MESMA
// conta antes de vincular: contact_tags não tem account_id, e um id trocado
// na config viraria vínculo entre contas sem ninguém notar. Contato que já
// tem a tag não gera erro.
export async function marcarContatoComTag(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  tagId: string | null | undefined,
): Promise<boolean> {
  if (!tagId) return false
  const { data: tag } = await db
    .from('tags')
    .select('id')
    .eq('id', tagId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!tag) {
    console.warn('[marcar-tag] tag não pertence à conta; ignorada')
    return false
  }
  const { error } = await db
    .from('contact_tags')
    .upsert({ contact_id: contactId, tag_id: tagId }, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true })
  return !error
}
