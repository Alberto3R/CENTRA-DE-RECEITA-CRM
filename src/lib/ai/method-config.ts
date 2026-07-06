// Configuração de método comercial por conta (multi-tenant, mercado aberto).
//
// O head comercIAl nasceu acoplado ao método "3R" (prompt hardcoded). Na fusão
// como SaaS de mercado, o método vira CONFIGURÁVEL por `account` via a tabela
// `account_sales_config` (migration 039). Este módulo define o contrato puro
// (sem acesso a banco) e o PRESET DE FÁBRICA = 3R.
//
// Regra de ouro anti-regressão: quando a conta NÃO customizou nada
// (`customizado === false`), os motores usam o texto 3R verbatim — garantindo
// zero regressão para a Sales 3R. Quando customizou, os prompts são montados a
// partir desta config.

/** Uma dimensão de análise de call (configurável por conta). */
export interface DimensaoSpec {
  /** Chave canônica usada no schema da tool e no golden set. snake_case. */
  key: string;
  /** Rótulo humano para UI. */
  label: string;
  /** O que o avaliador deve observar nesta dimensão (entra no system prompt). */
  descricao: string;
}

/** Config de método resolvida para uma conta. */
export interface MetodoConfig {
  /** Nome do método (ex.: "3R", "SPIN", "Sandler", "Consultivo"). */
  metodoNome: string;
  /** Persona/tom de voz do analista. null = padrão do método. */
  tomDeVoz: string | null;
  /** Ideal Customer Profile da conta (livre). null se não configurado. */
  icp: Record<string, unknown> | null;
  /** Produto da conta (livre). Usado pelos módulos de geração (scripts etc.). */
  produto: Record<string, unknown> | null;
  /** Oferta da conta (livre). Usado pelos módulos de geração. */
  oferta: Record<string, unknown> | null;
  /** Dimensões de análise. Default = as 7 do 3R. */
  dimensoes: DimensaoSpec[];
  /** Moeda para quantificar perdas (ISO 4217). Default BRL. */
  moeda: string;
  /**
   * false = conta usa o preset 3R de fábrica (motores usam texto verbatim).
   * true  = conta customizou método/dimensões/tom (motores montam do config).
   */
  customizado: boolean;
}

/** As 7 dimensões padrão do método 3R (ordem canônica — não reordenar). */
export const DIMENSOES_3R: DimensaoSpec[] = [
  {
    key: "abertura_rapport",
    label: "Abertura & Rapport",
    descricao:
      "Como abriu? Criou conexão, quebrou o gelo, ancorou autoridade?",
  },
  {
    key: "qualificacao_fit",
    label: "Qualificação & Fit",
    descricao:
      "Entendeu se o lead tem fit (orçamento, autoridade, necessidade, timing)?",
  },
  {
    key: "spin",
    label: "SPIN",
    descricao:
      "Aplicou SPIN: Situação, Problema, Implicação, Necessidade de solução? Cavou a dor?",
  },
  {
    key: "apresentacao",
    label: "Apresentação",
    descricao:
      "Apresentou a solução conectada à dor levantada, ou despejou features?",
  },
  {
    key: "preco",
    label: "Preço",
    descricao:
      "Como ancorou e defendeu o preço? Adiou, amarrou em valor, deu desconto fácil?",
  },
  {
    key: "objecoes",
    label: "Objeções",
    descricao:
      'Identificou e contornou objeções, ou aceitou o "vou pensar"?',
  },
  {
    key: "fechamento_proximos_passos",
    label: "Fechamento & Próximos Passos",
    descricao:
      "Pediu o avanço? Marcou próximo passo com data e compromisso?",
  },
];

/** Preset de fábrica: método 3R, sem customização (motores usam texto verbatim). */
export const CONFIG_3R: MetodoConfig = {
  metodoNome: "3R",
  tomDeVoz: null,
  icp: null,
  produto: null,
  oferta: null,
  dimensoes: DIMENSOES_3R,
  moeda: "BRL",
  customizado: false,
};

/** Símbolo de moeda para a memória de cálculo no prompt (fallback = código ISO). */
export function simboloMoeda(moeda: string): string {
  switch (moeda.toUpperCase()) {
    case "BRL":
      return "R$";
    case "USD":
      return "US$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    default:
      return moeda.toUpperCase();
  }
}
