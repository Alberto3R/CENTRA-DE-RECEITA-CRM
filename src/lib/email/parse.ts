/**
 * Leitura do que chega — a parte pura, sem rede.
 *
 * Tudo aqui existe porque e-mail não é WhatsApp: a mesma pessoa escreve de
 * `Fulano <F.Silva@Empresa.com>` hoje e `f.silva@empresa.com` amanhã, a
 * resposta vem com a conversa inteira citada embaixo, e o assunto acumula
 * "Re: Re: Enc:". Sem tratar isso, o inbox do CRM vira um paredão ilegível e
 * o mesmo lead vira três contatos.
 */

/** Endereço em minúsculas e sem o nome de exibição. É a chave de dedup. */
export function normalizarEmail(bruto: string | null | undefined): string {
  if (!bruto) return "";
  const dentroDosSinais = bruto.match(/<([^>]+)>/);
  const endereco = (dentroDosSinais ? dentroDosSinais[1] : bruto).trim();
  return endereco.toLowerCase();
}

/** O nome de exibição, quando vem ("Fulano <f@x.com>" → "Fulano"). */
export function nomeDoRemetente(bruto: string | null | undefined): string {
  if (!bruto) return "";
  const comNome = bruto.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  const nome = comNome ? comNome[1].trim() : "";
  // "f.silva@empresa.com <f.silva@empresa.com>" não é nome de gente.
  if (!nome || nome.includes("@")) return "";
  return nome;
}

/**
 * Todos os Message-ID que a mensagem cita, do mais recente para o mais antigo.
 *
 * `In-Reply-To` é o pai direto; `References` é a linhagem. Procuramos na ordem
 * porque o pai é quem tem mais chance de estar no nosso banco — e é assim que
 * a resposta cai na conversa certa em vez de abrir uma nova.
 */
export function extrairReferencias(
  inReplyTo: string | null | undefined,
  references: string | string[] | null | undefined,
): string[] {
  const cru: string[] = [];
  if (inReplyTo) cru.push(inReplyTo);
  if (Array.isArray(references)) cru.push(...references);
  else if (references) cru.push(references);

  const ids: string[] = [];
  for (const item of cru) {
    const achados = item.match(/<[^>]+>/g);
    if (achados) ids.push(...achados);
    else if (item.trim()) ids.push(`<${item.trim().replace(/^<|>$/g, "")}>`);
  }
  // Mantém a ordem de chegada (pai primeiro) e tira repetido.
  return [...new Set(ids)];
}

/** Tira "Re:", "RE:", "Enc:", "Fwd:" — inclusive empilhados. */
export function assuntoLimpo(assunto: string | null | undefined): string {
  if (!assunto) return "";
  return assunto.replace(/^\s*((re|res|enc|fw|fwd)\s*:\s*)+/i, "").trim();
}

const MARCADORES_DE_CITACAO = [
  // pt-BR (Gmail, Outlook, Zoho)
  /^\s*em\s+.{6,60}\s+escreveu\s*:/i,
  /^\s*-{2,}\s*mensagem original\s*-{2,}/i,
  /^\s*-{2,}\s*mensagem encaminhada\s*-{2,}/i,
  /^\s*de\s*:\s*.+\s*$/i,
  // en
  /^\s*on\s+.{6,60}\s+wrote\s*:/i,
  /^\s*-{2,}\s*original message\s*-{2,}/i,
  /^\s*from\s*:\s*.+\s*$/i,
];

/**
 * Corta o histórico citado, deixando só o que a pessoa escreveu agora.
 *
 * Sem isto, a terceira resposta de uma thread chega ao inbox com as duas
 * anteriores coladas embaixo, e o vendedor tem que caçar a frase nova. O corte
 * é conservador: na dúvida sobra texto, nunca falta — cortar demais esconde o
 * que o lead disse, que é o único conteúdo que importa aqui.
 */
export function removerCitacao(texto: string | null | undefined): string {
  if (!texto) return "";
  const linhas = texto.replace(/\r\n/g, "\n").split("\n");

  let corte = linhas.length;
  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i];
    const ehMarcador = MARCADORES_DE_CITACAO.some((re) => re.test(linha));
    // Bloco todo prefixado por ">" também é citação.
    const ehCitada = /^\s*>/.test(linha);
    if (ehMarcador || ehCitada) {
      corte = i;
      break;
    }
  }

  // Se o corte deixaria tudo vazio, a mensagem provavelmente É a citação
  // (resposta em cima de encaminhamento). Melhor devolver o texto inteiro do
  // que gravar um balão em branco no inbox.
  const cortado = linhas.slice(0, corte).join("\n").trim();
  return cortado || texto.trim();
}

/** Assinaturas ("--\n Fulano") não são conteúdo da mensagem. */
export function removerAssinatura(texto: string): string {
  const idx = texto.search(/^\s*--\s*$/m);
  if (idx === -1) return texto.trim();
  const cortado = texto.slice(0, idx).trim();
  return cortado || texto.trim();
}

/** O corpo que vai para o balão do inbox. */
export function corpoParaInbox(texto: string | null | undefined): string {
  return removerAssinatura(removerCitacao(texto)).trim();
}
