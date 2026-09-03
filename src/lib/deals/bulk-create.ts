import type { SupabaseClient } from "@supabase/supabase-js";

import { isUniqueViolation } from "@/lib/contacts/dedupe";

/**
 * Criação de negócios em massa a partir de uma lista de contatos.
 *
 * Dois consumidores, mesma regra: a barra de seleção da tela de Contatos
 * ("criar negócios para os selecionados") e a importação de CSV ("já criar
 * os negócios destes contatos"). O que muda entre eles é só de onde vêm os
 * `contactIds`.
 *
 * O título do negócio sai do nome do contato (telefone como reserva, para
 * lista importada sem nome). O prefixo opcional é o que dá para o vendedor
 * distinguir a leva: "Setembro — Maria Silva".
 */

/** Contato, no mínimo que o título precisa. */
export interface ContatoParaNegocio {
  id: string;
  name?: string | null;
  phone?: string | null;
}

export interface BulkCreateDealsOptions {
  contactIds: string[];
  pipelineId: string;
  stageId: string;
  accountId: string;
  userId: string;
  /** Responsável dos negócios criados. Vazio = sem responsável. */
  assignedTo?: string | null;
  /** Valor aplicado a todos. Default 0. */
  value?: number;
  currency?: string;
  /** Prefixo do título: "<prefixo> — <contato>". Vazio = só o contato. */
  titlePrefix?: string;
  /**
   * Pular contato que já tem negócio neste funil. Ligado por padrão —
   * rodar a mesma seleção duas vezes não deve duplicar o funil.
   */
  skipExisting?: boolean;
}

export interface BulkCreateDealsResult {
  created: number;
  /** Já tinham negócio no funil (ou vieram repetidos na lista). */
  skipped: number;
  failed: number;
}

/** Linha de `deals` pronta para insert. */
export interface DealRow {
  user_id: string;
  account_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string;
  title: string;
  value: number;
  currency: string;
  assigned_to: string | null;
  status: "open";
}

/** Título do negócio de um contato. */
export function dealTitle(
  contato: ContatoParaNegocio,
  titlePrefix?: string,
): string {
  const base =
    contato.name?.trim() || contato.phone?.trim() || "Contato sem nome";
  const prefixo = titlePrefix?.trim();
  return prefixo ? `${prefixo} — ${base}` : base;
}

/**
 * Monta as linhas de `deals` (parte pura, sem banco).
 *
 * `jaTemNegocio` são os contact_ids que já estão no funil; eles e as
 * repetições dentro da própria lista contam como pulados, não como falha.
 */
export function buildDealRows(
  contatos: ContatoParaNegocio[],
  opts: Omit<BulkCreateDealsOptions, "contactIds" | "skipExisting">,
  jaTemNegocio: Set<string> = new Set(),
): { rows: DealRow[]; skipped: number } {
  const vistos = new Set<string>();
  const rows: DealRow[] = [];
  let skipped = 0;

  for (const contato of contatos) {
    if (vistos.has(contato.id) || jaTemNegocio.has(contato.id)) {
      skipped++;
      continue;
    }
    vistos.add(contato.id);
    rows.push({
      user_id: opts.userId,
      account_id: opts.accountId,
      pipeline_id: opts.pipelineId,
      stage_id: opts.stageId,
      contact_id: contato.id,
      title: dealTitle(contato, opts.titlePrefix),
      value: Number.isFinite(opts.value) ? (opts.value as number) : 0,
      currency: opts.currency || "BRL",
      assigned_to: opts.assignedTo || null,
      status: "open",
    });
  }

  return { rows, skipped };
}

const CHUNK = 50;
/** Teto do `.in()` por consulta, para não estourar a URL do PostgREST. */
const LOOKUP_CHUNK = 200;

/**
 * Cria os negócios. Insere em blocos; se um bloco falha, repete linha a
 * linha para que um contato problemático não derrube os outros 49.
 */
export async function bulkCreateDeals(
  db: SupabaseClient,
  opts: BulkCreateDealsOptions,
): Promise<BulkCreateDealsResult> {
  const ids = [...new Set(opts.contactIds)].filter(Boolean);
  if (ids.length === 0) return { created: 0, skipped: 0, failed: 0 };

  // 1) Nome/telefone dos contatos, para o título.
  const contatos: ContatoParaNegocio[] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const { data, error } = await db
      .from("contacts")
      .select("id, name, phone")
      .in("id", ids.slice(i, i + LOOKUP_CHUNK));
    if (error) throw new Error(error.message);
    contatos.push(...((data ?? []) as ContatoParaNegocio[]));
  }

  // 2) Quem já está no funil.
  const jaTemNegocio = new Set<string>();
  if (opts.skipExisting !== false) {
    for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
      const { data } = await db
        .from("deals")
        .select("contact_id")
        .eq("pipeline_id", opts.pipelineId)
        .in("contact_id", ids.slice(i, i + LOOKUP_CHUNK));
      for (const row of (data ?? []) as { contact_id: string | null }[]) {
        if (row.contact_id) jaTemNegocio.add(row.contact_id);
      }
    }
  }

  const { rows, skipped: repetidos } = buildDealRows(
    contatos,
    opts,
    jaTemNegocio,
  );

  let created = 0;
  let skipped = repetidos;
  let failed = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const bloco = rows.slice(i, i + CHUNK);
    const { data, error } = await db.from("deals").insert(bloco).select("id");

    if (!error) {
      created += (data ?? []).length;
      continue;
    }

    for (const row of bloco) {
      const { error: soloErr } = await db.from("deals").insert(row);
      if (!soloErr) created++;
      // Corrida com outra aba/importação criando o mesmo negócio: é
      // duplicata evitada, não falha.
      else if (isUniqueViolation(soloErr)) skipped++;
      else failed++;
    }
  }

  return { created, skipped, failed };
}
