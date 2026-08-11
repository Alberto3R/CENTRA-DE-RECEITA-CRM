/**
 * Respostas rápidas — lógica pura do gatilho "/" no compositor do inbox.
 *
 * Fica isolada do componente porque o parsing é a parte fácil de errar:
 * o "/" só abre o menu quando inicia uma palavra, e o menu tem que fechar
 * assim que o cursor sai do token. Tudo aqui é testável sem React.
 */

/** Caracteres aceitos num atalho. Sem espaço — o espaço encerra o token. */
const SHORTCUT_CHARS = /^[\p{L}\p{N}_-]*$/u;

/**
 * Normaliza o que o usuário digitou como atalho: sem a barra inicial, sem
 * espaços, minúsculo. O índice único do banco é `lower(shortcut)`, então a
 * comparação no cliente tem que bater com isso.
 */
export function normalizeShortcut(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export interface SlashQuery {
  /** Índice do "/" no texto. */
  start: number;
  /** O que veio depois da barra, até o cursor. */
  query: string;
}

/**
 * Detecta se o cursor está dentro de um token iniciado por "/".
 *
 * Retorna null quando não há gatilho ativo — o que inclui o caso de uma
 * barra no meio de uma palavra (`https://algo`, `e/ou`), que não deve
 * abrir o menu.
 */
export function findSlashQuery(text: string, caret: number): SlashQuery | null {
  if (caret < 1 || caret > text.length) return null;

  // Anda para trás a partir do cursor procurando a barra que abre o token.
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "/") break;
    if (/\s/.test(ch)) return null; // espaço antes da barra ⇒ token não é slash
    i -= 1;
  }
  if (i < 0 || text[i] !== "/") return null;

  // A barra só conta se estiver no começo do texto ou depois de espaço.
  const before = i > 0 ? text[i - 1] : "";
  if (before && !/\s/.test(before)) return null;

  const query = text.slice(i + 1, caret);
  if (!SHORTCUT_CHARS.test(query)) return null;

  return { start: i, query };
}

export interface QuickReplyLike {
  shortcut: string;
  content: string;
}

/** Filtra e ordena por relevância: prefixo primeiro, depois substring. */
export function filterQuickReplies<T extends QuickReplyLike>(
  replies: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return replies;

  const prefix: T[] = [];
  const partial: T[] = [];
  for (const r of replies) {
    const s = r.shortcut.toLowerCase();
    if (s.startsWith(q)) prefix.push(r);
    else if (s.includes(q) || r.content.toLowerCase().includes(q)) partial.push(r);
  }
  return [...prefix, ...partial];
}

/**
 * Substitui o token "/atalho" pelo conteúdo da resposta.
 * Devolve o texto final e onde o cursor deve ficar.
 */
export function applyQuickReply(
  text: string,
  slash: SlashQuery,
  caret: number,
  content: string,
): { text: string; caret: number } {
  const next = text.slice(0, slash.start) + content + text.slice(caret);
  return { text: next, caret: slash.start + content.length };
}
