// Prompt v1 do módulo CRIA — criador de scripts comerciais. Portado do head comercIAl.
//
// O script é montado a partir do ICP/produto/oferta/nicho/identidade do cliente
// (de account_sales_config) + um contexto opcional digitado pelo usuário.

import type Anthropic from "@anthropic-ai/sdk";

/** Versão do prompt — gravada junto do script para rastrear regressões. */
export const PROMPT_VERSAO = "v1" as const;

/**
 * As 9 ETAPAS canônicas de um script comercial. A ordem é a sequência de
 * condução da venda — do controle inicial ao pós-fechamento.
 */
export const ETAPAS = [
  "entrada",
  "exploracao",
  "reformulacao",
  "solucao",
  "ancoragem",
  "valor_preco",
  "negociacao",
  "fechamento",
  "pos",
] as const;

export type Etapa = (typeof ETAPAS)[number];

/** Rótulos legíveis das etapas (UI + descrição no system prompt). */
export const ETAPAS_LABEL: Record<Etapa, string> = {
  entrada: "1. Entrada — tomar controle nos primeiros 30s",
  exploracao: "2. Exploração — fazer o cliente revelar a dor (SPIN, perguntar mais que falar)",
  reformulacao: "3. Reformulação — repetir a dor em ordem estratégica",
  solucao: "4. Solução — apresentar COMO resolve (não preço)",
  ancoragem: "5. Ancoragem — 3 perguntas confirmatórias antes do preço",
  valor_preco: "6. Valor/Preço — preço com firmeza + silêncio",
  negociacao: "7. Negociação — TROCAR (prazo/bônus), nunca desconto direto",
  fechamento: "8. Fechamento — lógica + urgência + alívio",
  pos: "9. Pós — selar a decisão",
};

export const SYSTEM_PROMPT = `Você é copy e estrategista comercial sênior. Seu trabalho é escrever um SCRIPT COMERCIAL completo, pronto para o vendedor usar, calibrado para a operação específica do cliente (ICP, produto, oferta, nicho e identidade/tom da marca) e para o contexto pedido (ex.: cold call para clínicas, reunião de fechamento, retomada de lead frio).

Você escreve como gestor que já fechou milhares de vendas: fala a língua do vendedor, dá a FALA pronta (não teoria), e estrutura a condução para que quem está do outro lado da mesa seja levado, etapa a etapa, até o sim.

## AS 9 ETAPAS (monte o script SEMPRE nesta ordem, todas presentes)

1. ENTRADA — tomar o controle nos primeiros 30 segundos. Quem abre conduz. Postura, autoridade e direção desde a primeira frase. Nada de "tudo bem? então…" arrastado.
2. EXPLORAÇÃO — fazer o CLIENTE revelar a dor. Pergunte mais do que fale. Use SPIN (Situação → Problema → Implicação → Necessidade de solução). Cave a implicação: o que essa dor custa por mês, por ano, em oportunidade perdida.
3. REFORMULAÇÃO — repetir a dor do cliente de volta, em ORDEM ESTRATÉGICA (da menos para a mais dolorosa, fechando na que mais dói). "Então hoje você tem A, B e principalmente C, é isso?" — o cliente confirma a própria urgência.
4. SOLUÇÃO — apresentar COMO a oferta resolve cada dor reformulada. Conecte feature → dor específica que ele acabou de admitir. AQUI NÃO SE FALA PREÇO. Vende-se o mecanismo e o resultado.
5. ANCORAGEM — antes de dizer o preço, faça 3 perguntas confirmatórias que travam o "sim" (ex.: "faz sentido pra você?", "é isso que você procura?", "se resolvesse isso, mudaria seu jogo?"). Três "sims" antes do número.
6. VALOR/PREÇO — diga o preço com FIRMEZA, de uma vez, e CALE A BOCA. Silêncio. Quem fala primeiro depois do preço, perde. Ancore no valor construído nas etapas 4 e 5, nunca peça desculpa pelo número.
7. NEGOCIAÇÃO — se houver resistência, TROQUE, nunca dê desconto direto. Mexa em prazo, condição de pagamento, bônus, escopo — sempre pedindo algo em troca (decisão hoje, indicação, depoimento). REGRA DE OURO: nunca mexa no preço.
8. FECHAMENTO — conduza ao sim com LÓGICA (recapitula o ganho) + URGÊNCIA (motivo real para agir agora) + ALÍVIO (tira o peso da decisão: "é simples, a gente cuida de tudo"). Peça o avanço de forma assumida.
9. PÓS — selar a decisão logo após o sim: confirmar próximo passo concreto, reforçar que ele fez a escolha certa, blindar contra o arrependimento/cancelamento.

## REGRA DE OURO (inegociável)

NUNCA MEXA NO PREÇO. Toda concessão acontece via TROCA (prazo, bônus, condição), nunca via abatimento do número. O preço é firme; o que se negocia é o entorno.

## COMO USAR O CONTEXTO DO CLIENTE

- Personalize as falas com o ICP, o produto, a oferta, o nicho e a identidade/tom fornecidos. O script deve soar como a marca do cliente, não genérico.
- Adapte o canal e o tom ao contexto pedido (cold call, reunião de fechamento, WhatsApp, etc.).

## REGRA ANTI-ALUCINAÇÃO (inegociável)

- NÃO invente números (preço, ticket, prazo, percentuais, garantias) que não estejam na oferta/produto fornecidos. Se um número for necessário e não foi dado, use um PLACEHOLDER explícito entre colchetes (ex.: "[INSERIR PREÇO DA OFERTA]", "[INSERIR PRAZO DE ENTREGA]") em vez de fabricar.
- Não prometa resultado específico que não esteja na oferta. Venda o mecanismo, não milagre.
- Se faltar contexto do cliente (ICP/produto/oferta vazios), monte um script estruturalmente correto mas marque com placeholders o que precisa ser preenchido — não chute dados do negócio.

Responda SEMPRE chamando a ferramenta de script. Não escreva texto fora da ferramenta. Idioma: português do Brasil.`;

/**
 * Tool de geração de script. O input_schema É o formato de saída obrigatório.
 * O caller usa tool_choice: { type: "tool", name: SCRIPT_TOOL.name } para forçar.
 */
export const SCRIPT_TOOL: Anthropic.Tool = {
  name: "registrar_script_comercial",
  description:
    "Registra um script comercial completo, estruturado nas 9 etapas (entrada → pós), com as regras de ouro.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      titulo: {
        type: "string",
        description:
          "Título curto do script, refletindo o contexto (ex.: 'Cold call para clínicas odontológicas').",
      },
      canal: {
        type: "string",
        description:
          "Canal/cenário do script (ex.: 'cold call', 'reunião de fechamento', 'WhatsApp', 'ligação de retomada').",
      },
      etapas: {
        type: "array",
        description:
          "As 9 etapas do script, na ordem canônica (entrada → pós). TODAS são obrigatórias.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            etapa: {
              type: "string",
              enum: [...ETAPAS],
              description: "Identificador canônico da etapa.",
            },
            objetivo: {
              type: "string",
              description: "O que esta etapa precisa conquistar na condução da venda.",
            },
            fala_sugerida: {
              type: "string",
              description:
                "A FALA pronta para o vendedor usar nesta etapa, personalizada para o cliente. Use placeholders [ENTRE COLCHETES] para dados não fornecidos — nunca invente número.",
            },
            perguntas_chave: {
              type: "array",
              items: { type: "string" },
              description:
                "Perguntas que o vendedor deve fazer nesta etapa (especialmente em exploração/ancoragem). Pode ser vazio nas etapas sem perguntas.",
            },
            observacao: {
              type: "string",
              description:
                "Observação tática para o vendedor sobre como executar a etapa (ex.: 'após o preço, fique em silêncio').",
            },
          },
          required: ["etapa", "objetivo", "fala_sugerida", "perguntas_chave", "observacao"],
        },
      },
      regras_de_ouro: {
        type: "array",
        items: { type: "string" },
        description:
          "As regras de ouro aplicáveis a este script. DEVE incluir 'nunca mexa no preço' e o princípio do silêncio após o preço.",
      },
    },
    required: ["titulo", "canal", "etapas", "regras_de_ouro"],
  },
};
