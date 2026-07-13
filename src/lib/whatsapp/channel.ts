// Resolução de CANAL (whatsapp_config) para envio.
//
// Multi-canal: a conta pode ter vários números. Uma conversa sabe o seu canal
// (conversations.channel_id). O envio deve sair pelo MESMO número em que a
// conversa acontece. Este helper resolve o canal certo com fallback seguro
// (canal primário → qualquer canal), pra nunca quebrar com dados legados.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChannelConfig = Record<string, any>;

/**
 * Resolve o canal de uma conta:
 *   1) o channelId dado, se pertencer à conta;
 *   2) senão, o canal primário (is_primary);
 *   3) senão, qualquer canal da conta.
 * Retorna null se a conta não tem nenhum canal configurado.
 */
export async function resolveChannelConfig(
  db: SupabaseClient,
  accountId: string,
  channelId?: string | null,
): Promise<ChannelConfig | null> {
  if (channelId) {
    const { data } = await db
      .from("whatsapp_config")
      .select("*")
      .eq("id", channelId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (data) return data as ChannelConfig;
  }

  const { data: primary } = await db
    .from("whatsapp_config")
    .select("*")
    .eq("account_id", accountId)
    .eq("is_primary", true)
    .maybeSingle();
  if (primary) return primary as ChannelConfig;

  const { data: fallback } = await db
    .from("whatsapp_config")
    .select("*")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle();
  return (fallback as ChannelConfig | null) ?? null;
}
