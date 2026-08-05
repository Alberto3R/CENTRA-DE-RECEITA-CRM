// ============================================================
// Platform admin — super admin e impersonation somente-leitura.
//
// Server-only: lê `platform_admins` e `impersonation_sessions`, que
// têm RLS ligado e nenhuma policy. São inalcançáveis pelo cliente por
// construção, então todo acesso passa por service role — sempre depois
// de verificar a identidade do chamador com o cliente SSR.
//
// A segurança real está no banco (migration 084): a policy só concede
// LEITURA, e só do tenant da sessão ativa. O que este módulo faz é a
// segunda camada — recusar rotas de escrita antes mesmo de chegar ao
// Postgres — e resolver qual conta a aplicação deve mostrar.
//
// As duas camadas são independentes de propósito: se esta falhar, o
// banco ainda nega a escrita; se alguém afrouxar a policy, esta ainda
// nega a rota.
// ============================================================

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { ForbiddenError, UnauthorizedError } from "./errors";

/**
 * Duração da sessão de impersonation.
 *
 * Curta de propósito: sessão de suporte é minutos, não horas, e o
 * prazo é a rede de segurança para quem esquece de sair. Renovar é
 * abrir outra sessão — o que deixa mais uma linha no log, que é
 * exatamente o comportamento desejado.
 */
export const IMPERSONATION_TTL_MINUTES = 30;

/** Mínimo do motivo — o mesmo CHECK existe no banco. */
export const MIN_REASON_LENGTH = 10;

export interface ImpersonationSession {
  id: string;
  actorUserId: string;
  targetAccountId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  actor_user_id: string;
  target_account_id: string;
  reason: string;
  started_at: string;
  expires_at: string;
}

function toSession(row: SessionRow): ImpersonationSession {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    targetAccountId: row.target_account_id,
    reason: row.reason,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
  };
}

/** O usuário está na tabela de platform admins? */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[platform-admin] falha ao verificar admin:", error);
      return false;
    }
    return data != null;
  } catch (err) {
    // Falha de leitura NUNCA vira permissão. Sem conseguir confirmar
    // que alguém é admin de plataforma, a resposta é não.
    console.error("[platform-admin] verificação indisponível:", err);
    return false;
  }
}

/**
 * Sessão de impersonation ativa do usuário, ou null.
 *
 * Espelha exatamente as condições de `current_impersonation()` no
 * banco — inclusive o join com `platform_admins`, para que revogar um
 * admin invalide a sessão aqui e lá ao mesmo tempo. Se as duas
 * divergirem, a aplicação mostraria dados de um tenant que o Postgres
 * já não deixa ler, e a tela quebraria de um jeito confuso em vez de
 * simplesmente sair da impersonation.
 */
export async function getActiveImpersonation(
  userId: string,
): Promise<ImpersonationSession | null> {
  // Este é o único helper do módulo chamado em TODA requisição
  // autenticada (via getCurrentAccount), então ele não pode derrubar o
  // app. Qualquer falha — service role não configurada, tabela ainda
  // não migrada, banco fora — vira "não há impersonation", que é o
  // estado seguro: o usuário enxerga a própria conta.
  //
  // Os outros helpers daqui continuam lançando, porque só rodam em
  // rotas do painel, onde falhar em silêncio esconderia o problema.
  let data: SessionRow | null = null;
  try {
    const result = await supabaseAdmin()
      .from("impersonation_sessions")
      .select("id, actor_user_id, target_account_id, reason, started_at, expires_at")
      .eq("actor_user_id", userId)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) {
      console.error("[platform-admin] falha ao ler sessão ativa:", result.error);
      return null;
    }
    data = result.data as SessionRow | null;
  } catch (err) {
    console.error("[platform-admin] sessão ativa indisponível:", err);
    return null;
  }

  if (!data) return null;

  // Confirmação separada em vez de join: `impersonation_sessions` e
  // `platform_admins` referenciam auth.users, mas não uma à outra, então
  // o PostgREST não tem relação para inferir um embed. A checagem
  // continua obrigatória — é ela que faz revogar um admin derrubar as
  // sessões dele, igual ao join dentro de current_impersonation().
  if (!(await isPlatformAdmin(userId))) return null;

  return toSession(data as SessionRow);
}

/**
 * Exige que o chamador seja platform admin. Devolve o cliente SSR (com
 * a identidade real dele) e o userId.
 */
export async function requirePlatformAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();

  if (!(await isPlatformAdmin(user.id))) {
    // Mensagem deliberadamente igual à de qualquer outro 403: quem não
    // é admin de plataforma não deve nem descobrir que o painel existe.
    throw new ForbiddenError("Forbidden");
  }
  return { supabase, userId: user.id };
}

/**
 * Abre uma sessão de impersonation.
 *
 * Encerra a anterior, se houver: uma sessão por vez torna "em qual
 * cliente eu estou?" uma pergunta com uma resposta só — tanto na tela
 * quanto no log.
 */
export async function startImpersonation(args: {
  actorUserId: string;
  targetAccountId: string;
  reason: string;
}): Promise<ImpersonationSession> {
  const { actorUserId, targetAccountId, reason } = args;
  const admin = supabaseAdmin();

  await endImpersonation({ actorUserId });

  const expiresAt = new Date(
    Date.now() + IMPERSONATION_TTL_MINUTES * 60_000,
  ).toISOString();

  const { data, error } = await admin
    .from("impersonation_sessions")
    .insert({
      actor_user_id: actorUserId,
      target_account_id: targetAccountId,
      reason: reason.trim(),
      expires_at: expiresAt,
    })
    .select("id, actor_user_id, target_account_id, reason, started_at, expires_at")
    .single();

  if (error || !data) {
    console.error("[platform-admin] falha ao abrir sessão:", error);
    throw new Error("Não foi possível abrir a sessão de impersonation.");
  }
  return toSession(data as SessionRow);
}

/**
 * Encerra as sessões ativas do usuário (idempotente).
 *
 * Preenche `ended_at` — o único UPDATE que o trigger append-only
 * aceita. A linha permanece no log.
 */
export async function endImpersonation(args: {
  actorUserId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("impersonation_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("actor_user_id", args.actorUserId)
    .is("ended_at", null);
  if (error) {
    console.error("[platform-admin] falha ao encerrar sessão:", error);
    throw new Error("Não foi possível encerrar a sessão de impersonation.");
  }
}
