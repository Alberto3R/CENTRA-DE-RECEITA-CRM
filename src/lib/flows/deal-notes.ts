/**
 * Leitura de uma linha rotulada das notas do negócio.
 *
 * As notas do Diagnóstico são um bloco de texto com linhas "Rótulo: valor" —
 * é de lá que saem o link do PDF e o buraco principal citados nos toques 2 e
 * 4 da régua. Isolado do motor porque é puro e cheio de canto: rótulo com
 * caracteres de regex, valor com espaços, lista separada por " · ".
 */
export function extrairNotaDoNegocio(
  notas: string | null | undefined,
  rotulo: string,
): string {
  if (!notas || !rotulo.trim()) return "";
  // O usuário digita "PDF do diagnóstico", não uma expressão regular.
  const escapado = rotulo.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const achado = notas.match(new RegExp(`${escapado}:\\s*([^\\n]+)`, "i"));
  if (!achado) return "";
  // "Maiores buracos: A · B · C" — a régua cita o primeiro.
  return achado[1].trim().split(" · ")[0].trim();
}
