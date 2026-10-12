// Regras de texto do agente de grupo: foi marcado? é um "ok"? é um código de
// vínculo? Funções puras — o webhook decide o que fazer com elas.

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * O WhatsApp escreve a marcação no texto como "@<número>" (ou "@<lid>" nas
 * contas novas). A Z-API não traz campo próprio de menção, então detectamos
 * pelo texto: qualquer um dos ids do agente depois de um "@", ou um apelido
 * ("@assistente") para quem digita na mão.
 */
export function isMention(
  text: string,
  botIds: (string | null | undefined)[],
  aliases: string[] = ['assistente', 'agente']
): boolean {
  const t = text.toLowerCase();
  for (const id of botIds) {
    const d = digits(id);
    if (d.length >= 8 && new RegExp(`@\\+?${d}(?!\\d)`).test(t)) return true;
    // número sem o 55, como alguns celulares exibem
    if (
      d.startsWith('55') &&
      d.length >= 12 &&
      new RegExp(`@${d.slice(2)}(?!\\d)`).test(t)
    )
      return true;
  }
  return aliases.some((a) => new RegExp(`(^|\\s)@${a}\\b`, 'i').test(text));
}

/** Remove as marcações para a IA ler só o pedido. */
export function stripMentions(text: string): string {
  return text
    .replace(/@\+?\d{8,}/g, '')
    .replace(/(^|\s)@(assistente|agente)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SIM =
  /^(ok|okay|sim|s|pode|pode sim|confirmo|confirma|confirmado|manda|manda ver|vai|bora|isso|fechado|executa|faz|pode fazer|👍|✅)[\s.!]*$/i;
const NAO =
  /^(n[aã]o|nao|cancela|cancelar|cancelado|para|esquece|deixa|deixa pra l[aá]|❌)[\s.!]*$/i;

/** Resposta curta de confirmação ("ok", "sim", "pode"), já sem a marcação. */
export function isConfirm(text: string): boolean {
  return SIM.test(stripMentions(text));
}

export function isCancel(text: string): boolean {
  return NAO.test(stripMentions(text));
}

/** "VINCULAR-4F7K2Q" em qualquer lugar do texto (sem diferenciar caixa). */
export function extractLinkCode(text: string): string | null {
  const m = text.toUpperCase().match(/\bVINCULAR-[A-Z0-9]{6}\b/);
  return m ? m[0] : null;
}

/** Código novo: VINCULAR- + 6 caracteres sem ambíguos (sem 0/O/1/I). */
export function newLinkCode(rand: () => number = Math.random): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[Math.floor(rand() * abc.length)];
  return `VINCULAR-${s}`;
}
