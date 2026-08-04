/**
 * Filtro de busca de contatos para o PostgREST.
 *
 * Fica aqui, fora do componente, porque tem uma armadilha que só aparece com
 * entrada real: `%` e `_` são curingas do LIKE. Sem escapar, alguém buscando
 * "50%" casa com TODOS os contatos, e "_" casa com qualquer caractere. O
 * escape é a razão de existir desta função — e é o que o teste protege.
 */

/** Colunas varridas pela busca. A ordem não importa; o PostgREST faz OR. */
const SEARCH_COLUMNS = [
  "name",
  "phone",
  "email",
  "instagram_username",
] as const;

/** Escapa os curingas do LIKE para que sejam buscados literalmente. */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Monta o argumento do `.or()` do PostgREST para buscar `term` em todas as
 * colunas de contato. Devolve `null` quando o termo é vazio — o chamador
 * então lista os contatos recentes em vez de filtrar por nada.
 */
export function contactSearchFilter(term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  const safe = escapeLikeTerm(trimmed);
  return SEARCH_COLUMNS.map((col) => `${col}.ilike.%${safe}%`).join(",");
}
