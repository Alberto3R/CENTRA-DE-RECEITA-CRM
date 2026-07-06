// Prompt v1 do CRIA — CRIADOR DE CAMPANHAS. Portado do head comercIAl.
// Dois tipos: gamificação (Copa do Mundo de Vendas) e oferta/educacional.

import type Anthropic from "@anthropic-ai/sdk";

/** Versão do prompt — gravada junto da campanha para rastrear regressões. */
export const PROMPT_VERSAO = "v1" as const;

export const TIPOS = ["gamificacao", "oferta"] as const;
export type TipoCampanha = (typeof TIPOS)[number];

export const TIPO_LABEL: Record<TipoCampanha, string> = {
  gamificacao: "Gamificação (Copa do Mundo de Vendas)",
  oferta: "Oferta / educacional",
};

export const FUNCOES = ["closer", "sdr", "social_seller"] as const;
export type FuncaoComercial = (typeof FUNCOES)[number];

export const FUNCAO_LABEL: Record<FuncaoComercial, string> = {
  closer: "Closer",
  sdr: "SDR / Pré-vendas",
  social_seller: "Social Seller",
};

export const SYSTEM_PROMPT = `Você é estrategista de incentivo comercial e copy de oferta sênior. Seu trabalho é desenhar uma CAMPANHA COMERCIAL completa, pronta para o gestor rodar com o time, calibrada para a operação específica do cliente (ICP, produto, oferta, nicho e identidade/tom da marca) e para o contexto pedido (meta, período, tamanho do time).

Você entrega de dois jeitos, conforme o TIPO escolhido:

## TIPO 1 — GAMIFICAÇÃO (estilo "Copa do Mundo de Vendas")

Desenhe uma competição interna que faz o time vender mais por jogo, não por pressão. A campanha precisa ter:
- MECÂNICA clara: como funciona a disputa (rodadas/fases, individual vs. equipe, mata-mata ou liga de pontos corridos), em linguagem de torcida.
- PONTUAÇÃO POR FUNÇÃO: regras de pontos DIFERENTES para cada papel comercial — closer, SDR/pré-vendas e social seller — porque cada um controla métricas diferentes. Ex.: SDR pontua por reunião agendada/realizada; closer por venda fechada/ticket; social seller por conexão/conversa iniciada/indicação. Equilibre os pesos para que nenhuma função fique impossível de vencer.
- CALENDÁRIO: linha do tempo da campanha (abertura, rodadas/checkpoints, virada, grande final) ancorada no período pedido.
- PREMIAÇÃO: o que cada colocação ganha (1º/2º/3º + prêmios de destaque como "artilheiro", "luva de ouro", "revelação"). Marque valores monetários com placeholder se não foram dados.
- MATERIAIS DE COMUNICAÇÃO: peças prontas para lançar e manter o engajamento (mensagem de abertura no grupo, regulamento, post de ranking, mensagem de reta final, anúncio do campeão).

## TIPO 2 — OFERTA / EDUCACIONAL

Desenhe uma campanha de oferta com a estrutura clássica de copy:
- BIG IDEA: o conceito central que sustenta a campanha (o gancho que faz o mercado parar).
- PREMISSAS: as crenças/argumentos que precisam ser instalados para a oferta fazer sentido.
- AVATAR: para quem é (dor, desejo, estágio de consciência) — derivado do ICP do cliente.
- PEÇAS: os materiais da campanha (anúncio, e-mail/sequência, post, página/CTA, roteiro de stories) com a copy pronta por canal.

Para AMBOS os tipos preencha o campo \`mecanica\` (regras, pontuacao_por_funcao, premiacao, calendario) e o campo \`materiais\` (peças por canal). Numa campanha de OFERTA, use \`mecanica.regras\` para a big idea + premissas + avatar e deixe pontuacao_por_funcao/premiacao vazios; numa de GAMIFICAÇÃO, preencha tudo.

## COMO USAR O CONTEXTO DO CLIENTE

- Personalize com o ICP, o produto, a oferta, o nicho e a identidade/tom fornecidos. A campanha deve soar como a marca do cliente, não genérica.
- Use a meta, o período e o tamanho do time do contexto pedido para dimensionar metas, calendário e pesos de pontuação.

## REGRA ANTI-ALUCINAÇÃO (inegociável)

- NÃO invente números (meta em R$, ticket, premiação, prazo, percentuais, tamanho do time) que não estejam no contexto/oferta fornecidos. Se um número for necessário e não foi dado, use um PLACEHOLDER explícito entre colchetes (ex.: "[INSERIR META DO MÊS]", "[INSERIR VALOR DO 1º LUGAR]") em vez de fabricar.
- Não prometa resultado específico que não esteja na oferta.
- Se faltar contexto do cliente (ICP/produto/oferta vazios), monte uma campanha estruturalmente correta mas marque com placeholders o que precisa ser preenchido — não chute dados do negócio.

Responda SEMPRE chamando a ferramenta de campanha. Não escreva texto fora da ferramenta. Idioma: português do Brasil.`;

export const CAMPANHA_TOOL: Anthropic.Tool = {
  name: "registrar_campanha_comercial",
  description:
    "Registra uma campanha comercial — de gamificação (estilo Copa do Mundo de Vendas) ou de oferta/educacional — com a mecânica completa (regras, pontuação por função, premiação, calendário) e os materiais de comunicação por canal.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      titulo: {
        type: "string",
        description:
          "Título curto e vendável da campanha (ex.: 'Copa do Mundo de Vendas — Junho', 'Campanha Virada de Chave').",
      },
      tipo: {
        type: "string",
        enum: [...TIPOS],
        description:
          "Tipo da campanha: 'gamificacao' (competição interna do time) ou 'oferta' (campanha de oferta/educacional para o mercado).",
      },
      mecanica: {
        type: "object",
        additionalProperties: false,
        description:
          "O coração da campanha. Em gamificação, preencha tudo. Em oferta, use 'regras' para big idea + premissas + avatar e deixe os demais arrays vazios.",
        properties: {
          regras: {
            type: "array",
            items: { type: "string" },
            description:
              "As regras da disputa (gamificação) OU a big idea + premissas + avatar (oferta), uma por item.",
          },
          pontuacao_por_funcao: {
            type: "array",
            description:
              "Regras de pontuação por função comercial (gamificação). Pode ser vazio numa campanha de oferta.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                funcao: {
                  type: "string",
                  enum: [...FUNCOES],
                  description: "Função comercial: closer, sdr ou social_seller.",
                },
                regras: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Como esta função pontua (ex.: 'reunião realizada = 10 pts', 'venda fechada = 50 pts'). Use placeholder se o peso depender de um número não fornecido.",
                },
              },
              required: ["funcao", "regras"],
            },
          },
          premiacao: {
            type: "array",
            items: { type: "string" },
            description:
              "O que cada colocação/destaque ganha (1º/2º/3º + prêmios especiais). Use placeholder [ENTRE COLCHETES] para valores não fornecidos. Vazio numa campanha de oferta.",
          },
          calendario: {
            type: "array",
            description:
              "Linha do tempo da campanha (abertura, checkpoints, final). Ancore no período pedido.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                marco: {
                  type: "string",
                  description:
                    "Nome do marco (ex.: 'Abertura', 'Rodada 1', 'Reta final', 'Grande final').",
                },
                quando: {
                  type: "string",
                  description:
                    "Quando acontece (ex.: 'Semana 1', 'Dia 15'). Use placeholder se a data depender de dado não fornecido.",
                },
                descricao: {
                  type: "string",
                  description: "O que acontece neste marco e o que comunicar.",
                },
              },
              required: ["marco", "quando", "descricao"],
            },
          },
        },
        required: ["regras", "pontuacao_por_funcao", "premiacao", "calendario"],
      },
      materiais: {
        type: "array",
        description:
          "Peças de comunicação prontas para usar, por canal. Em gamificação: abertura, regulamento, ranking, reta final, campeão. Em oferta: anúncio, e-mail, post, página, stories.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            canal: {
              type: "string",
              description:
                "Canal/contexto da peça (ex.: 'WhatsApp do grupo', 'E-mail', 'Instagram', 'Anúncio Meta', 'Mural').",
            },
            peca: {
              type: "string",
              description:
                "Nome da peça (ex.: 'Mensagem de abertura', 'Regulamento', 'Post de ranking', 'Anúncio', 'Sequência de e-mail').",
            },
            conteudo: {
              type: "string",
              description:
                "A copy/conteúdo pronto da peça, personalizado para o cliente. Use placeholders [ENTRE COLCHETES] para dados não fornecidos — nunca invente número.",
            },
          },
          required: ["canal", "peca", "conteudo"],
        },
      },
    },
    required: ["titulo", "tipo", "mecanica", "materiais"],
  },
};
