// Consultas em lote para listas grandes de IDs.
//
// O `.in("id", ids)` do PostgREST põe os IDs na URL da requisição. Com ~700
// UUIDs a URL passa de 27 mil caracteres e volta 400 — foi o que travou o
// disparo por etiqueta de uma conta com 697 contatos. Em lotes de 100
// (~4 KB de URL) passa com folga.
//
// E toda leitura sem `.range()` para em 1.000 linhas (max-rows do PostgREST),
// então uma etiqueta com 1.500 contatos traria só 1.000 — sem erro nenhum.

/** Valores por `.in(...)`: 100 UUIDs ≈ 4 KB de URL. */
export const IN_CHUNK = 100;

/** Linhas por página numa leitura paginada (o max-rows padrão do PostgREST). */
export const PAGE_SIZE = 1000;

type Result<R> = PromiseLike<{ data: R[] | null; error: { message: string } | null }>;

export function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Roda `run` para cada fatia de `ids` e junta as linhas. Para no primeiro erro
 * e o devolve — quem chama decide se aborta (nunca segue com a lista pela
 * metade achando que está inteira).
 */
export async function selectInChunks<R>(
  ids: readonly string[],
  run: (slice: string[]) => Result<R>,
  size = IN_CHUNK,
): Promise<{ data: R[]; error: { message: string } | null }> {
  const data: R[] = [];
  for (const slice of chunks(ids, size)) {
    const { data: rows, error } = await run(slice);
    if (error) return { data, error };
    if (rows) data.push(...rows);
  }
  return { data, error: null };
}

/**
 * Lê todas as páginas de uma consulta. `run(from, to)` deve aplicar
 * `.range(from, to)` (e uma ordenação estável) à consulta.
 */
export async function selectAllPages<R>(
  run: (from: number, to: number) => Result<R>,
  pageSize = PAGE_SIZE,
): Promise<{ data: R[]; error: { message: string } | null }> {
  const data: R[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data: rows, error } = await run(from, from + pageSize - 1);
    if (error) return { data, error };
    const page = rows ?? [];
    data.push(...page);
    if (page.length < pageSize) return { data, error: null };
  }
}
