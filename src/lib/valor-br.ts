/**
 * Leitura de valor monetário digitado no formato brasileiro.
 *
 * O campo "Valor" do negócio era um <input type="number"> lido com
 * parseFloat: "13.685" (treze mil seiscentos e oitenta e cinco, como o
 * vendedor escreve) virava 13,685 e o banco gravava R$ 13,69.
 *
 * Regras:
 * - ignora "R$", espaços e qualquer coisa que não seja dígito, ponto,
 *   vírgula ou sinal de menos;
 * - com ponto E vírgula, o separador que aparece por último é o decimal
 *   ("13.685,50" e "13,685.50" → 13685.5);
 * - com um só tipo de separador repetido, ele é de milhar
 *   ("1.250.000" → 1250000);
 * - com um único separador: seguido de exatamente 3 dígitos é milhar
 *   ("13.685" e "13,685" → 13685); seguido de 1 ou 2 dígitos é decimal
 *   ("1500,5" e "1500.50" → 1500.5).
 *
 * Devolve null quando não há número legível (vazio, só letras).
 */
export function parseValorBR(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const negativo = /^\s*-/.test(input) || /-\s*$/.test(input);
  const s = input.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;

  const ultimoPonto = s.lastIndexOf(".");
  const ultimaVirgula = s.lastIndexOf(",");
  let inteiro: string;
  let decimal = "";

  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    const sep = Math.max(ultimoPonto, ultimaVirgula);
    inteiro = s.slice(0, sep);
    decimal = s.slice(sep + 1);
  } else if (ultimoPonto >= 0 || ultimaVirgula >= 0) {
    const sepChar = ultimoPonto >= 0 ? "." : ",";
    const partes = s.split(sepChar);
    const ultima = partes[partes.length - 1];
    if (partes.length > 2 || ultima.length === 3) {
      inteiro = partes.join("");
    } else {
      inteiro = partes[0];
      decimal = ultima;
    }
  } else {
    inteiro = s;
  }

  inteiro = inteiro.replace(/[.,]/g, "");
  decimal = decimal.replace(/[.,]/g, "");
  const n = Number(`${inteiro || "0"}${decimal ? `.${decimal}` : ""}`);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/** Valor salvo → texto no campo de edição, com vírgula decimal ("13685,5"). */
export function valorParaCampo(v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}

/**
 * Prévia do valor lido, para o vendedor conferir antes de salvar
 * ("R$ 13.685" / "R$ 1.500,50"). Mostra centavos só quando existem.
 */
export function previaValorBR(n: number, currency: string): string {
  const casas = Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: (currency || "BRL").trim(),
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    }).format(n);
  } catch {
    return `${currency} ${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    }).format(n)}`;
  }
}
