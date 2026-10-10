// Base de conhecimento do chat de ajuda: os artigos da Central de Ajuda.
//
// A Central mora no projeto do site (site-central-de-receita) e é publicada em
// /ajuda/dados.js como `window.AJUDA = {cats:[...]}`. O chat lê esse mesmo
// arquivo, então artigo novo ou corrigido no site já vale para o chat, sem
// deploy do CRM. Cache em memória de 10 minutos por instância.

export const SITE_AJUDA = "https://site-central-de-receita.vercel.app/ajuda";
export const URL_PUBLICA_AJUDA = "https://www.centraldereceita.com.br/ajuda";

export interface ArtigoAjuda {
  slug: string;
  titulo: string;
  resumo: string;
  quem: string;
  texto: string;
  categoria: string;
}

interface DadosAjuda {
  cats: {
    slug: string;
    nome: string;
    artigos: { slug: string; titulo: string; resumo: string; quem: string; texto: string }[];
  }[];
}

const TTL_MS = 10 * 60 * 1000;
let cache: { em: number; artigos: ArtigoAjuda[] } | null = null;

/** Extrai o JSON de `window.AJUDA = {...};`. */
export function parseDadosAjuda(js: string): ArtigoAjuda[] {
  const ini = js.indexOf("{");
  const fim = js.lastIndexOf("}");
  if (ini < 0 || fim < ini) return [];
  const dados = JSON.parse(js.slice(ini, fim + 1)) as DadosAjuda;
  return (dados.cats ?? []).flatMap((c) =>
    (c.artigos ?? []).map((a) => ({
      slug: a.slug,
      titulo: a.titulo,
      resumo: a.resumo ?? "",
      quem: a.quem ?? "",
      texto: a.texto ?? "",
      categoria: c.nome,
    })),
  );
}

export async function carregarArtigos(): Promise<ArtigoAjuda[]> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.artigos;
  const res = await fetch(`${SITE_AJUDA}/dados.js`, { cache: "no-store" });
  if (!res.ok) {
    if (cache) return cache.artigos; // site fora do ar: segue com a última cópia
    throw new Error(`Central de Ajuda indisponível (${res.status}).`);
  }
  const artigos = parseDadosAjuda(await res.text());
  cache = { em: Date.now(), artigos };
  return artigos;
}

export function linkArtigo(slug: string): string {
  return `${URL_PUBLICA_AJUDA}#/a/${slug}`;
}

// ---------------------------------------------------------------------------
// Busca: pontua título, resumo, categoria e texto (sem acento, sem palavras
// vazias). Simples de propósito — são ~140 artigos curtos.
// ---------------------------------------------------------------------------

const VAZIAS = new Set(
  "a o as os de da do das dos e em no na nos nas um uma uns umas para pra pro por com sem que se como qual quais onde quando eu meu minha meus minhas voce voces ele ela isso esse essa este esta ja nao sim mais menos tem ter ser estar foi faz fazer fica ficar consigo posso pode preciso quero sobre ao aos la lo me te lhe nos the".split(
    " ",
  ),
);

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
}

// Como o cliente fala → como a Central de Ajuda escreve.
const SINONIMOS: Record<string, string> = {
  vendedor: "membro convidar equipe",
  vendedores: "membro convidar equipe",
  colaborador: "membro convidar equipe",
  funcionario: "membro convidar equipe",
  usuario: "membro convidar equipe",
  usuarios: "membro convidar equipe",
  acesso: "membro convidar perfil",
  zap: "whatsapp",
  wpp: "whatsapp",
  numero: "whatsapp canal",
  robo: "agente",
  bot: "agente",
  ia: "agente",
  atendente: "agente",
  etiqueta: "tag",
  etiquetas: "tags",
  pipeline: "funil",
  kanban: "funil",
  card: "negocio",
  cartao: "negocio",
  oportunidade: "negocio",
  lead: "contato",
  leads: "contatos",
  template: "modelo",
  templates: "modelos",
  campanha: "disparo",
  massa: "disparo",
  planilha: "importar csv",
  excel: "importar csv",
  senha: "senha login",
  pagamento: "assinatura plano",
  plano: "assinatura plano",
  cobranca: "assinatura",
  indicador: "painel",
  indicadores: "painel",
  metricas: "painel",
  relatorio: "relatorios",
}

export function termosDaPergunta(pergunta: string): string[] {
  const base = normalizar(pergunta).split(/\s+/)
  const expandida = base.flatMap((t) => (SINONIMOS[t] ? [t, ...SINONIMOS[t].split(" ")] : [t]))
  return Array.from(
    new Set(
      expandida
        .filter((t) => (t.length > 2 || t === "ia") && !VAZIAS.has(t))
        // radical simples: "conectar"/"conexão"/"conectado" casam por "conect"
        .map((t) => (t.length > 6 ? t.slice(0, t.length - 2) : t)),
    ),
  );
}

export function buscarArtigos(
  artigos: ArtigoAjuda[],
  pergunta: string,
  limite = 6,
): ArtigoAjuda[] {
  const termos = termosDaPergunta(pergunta);
  if (!termos.length) return [];
  const pontuados = artigos.map((a) => {
    const t = normalizar(a.titulo);
    const r = normalizar(a.resumo);
    const c = normalizar(a.categoria);
    const x = normalizar(a.texto);
    let pontos = 0;
    let casados = 0;
    for (const termo of termos) {
      let p = 0;
      if (t.includes(termo)) p += 8;
      if (r.includes(termo)) p += 4;
      if (c.includes(termo)) p += 2;
      if (x.includes(termo)) p += 1 + Math.min(3, x.split(termo).length - 2);
      if (p) casados++;
      pontos += p;
    }
    // quem casa mais termos diferentes vem antes de quem repete um só
    return { a, pontos: pontos * (casados / termos.length) };
  });
  return pontuados
    .filter((p) => p.pontos > 0)
    .sort((x, y) => y.pontos - x.pontos)
    .slice(0, limite)
    .map((p) => p.a);
}
