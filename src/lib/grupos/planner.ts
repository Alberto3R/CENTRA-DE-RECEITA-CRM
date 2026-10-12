// Planejador do agente de grupo: lê o pedido + o estado da conta e devolve OU
// um plano (ações da lista fechada) OU uma resposta em texto. Nunca executa —
// quem executa é executePlan(), depois do "ok" de quem pediu.

import type Anthropic from '@anthropic-ai/sdk';
import {
  getAnthropic,
  MODELO_ANALISE,
  systemCacheado,
  toolsCacheadas,
} from '@/lib/ai/anthropic';
import { FUNCOES } from '@/lib/pipelines/funcoes';
import { MODELOS } from '@/lib/pipelines/modelos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type PlannerOutput =
  | { kind: 'plan'; resumo: string; acoes: unknown[] }
  | { kind: 'answer'; texto: string };

const SYSTEM = `Você é o Assistente 3R, um agente dentro do grupo de WhatsApp entre a Sales 3R e um cliente do CRM "Central de Receita". Alguém do grupo te marcou com um pedido.

Você só sabe fazer estas ações no CRM do cliente (e NADA além disso):
- criar_funil: cria um funil de vendas. Ou a partir de um modelo da biblioteca (modelo_id), ou com etapas próprias, cada uma com uma função.
- adicionar_etapa: adiciona uma etapa a um funil que já existe.
- criar_tag: cria uma tag de contato.
- criar_template: cria um modelo de mensagem do WhatsApp (API oficial) e envia para aprovação da Meta.

Regras:
1. Se o pedido cabe nessas ações e tem informação suficiente, chame "propor_plano". O plano será mostrado no grupo e só roda depois de um "ok".
2. Se faltar algo essencial (ex.: nome do funil, texto do template), ou se o pedido for outra coisa (apagar, editar, disparar mensagem, mexer em lead, configurar integração, pergunta), chame "responder": peça o que falta em UMA pergunta curta, ou diga com franqueza que isso você ainda não faz e que a equipe 3R vai cuidar.
3. Funil com etapas próprias: dê a cada etapa a função certa (ver lista). Todo funil termina com uma etapa "ganho" e uma "perdido". Se o pedido bater com um modelo da biblioteca, prefira o modelo.
4. Template: nome em minúsculas_com_underline; categoria Utility para aviso/confirmação/lembrete de algo que a pessoa pediu, Marketing para oferta/convite/novidade; variáveis {{1}}, {{2}}… com um exemplo para cada; o texto NÃO pode começar nem terminar com variável. Não invente preço, link ou promessa que o pedido não trouxe.
5. Fale como gente, em português do Brasil, curto, sem jargão técnico. Nunca diga "IA", "sistema" ou "algoritmo": você é o Assistente 3R.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'propor_plano',
    description:
      'Propõe as ações a executar no CRM. Elas só rodam depois da confirmação de quem pediu.',
    input_schema: {
      type: 'object',
      properties: {
        resumo: {
          type: 'string',
          description: 'Uma frase dizendo o que você entendeu do pedido.',
        },
        acoes: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              tipo: {
                type: 'string',
                enum: [
                  'criar_funil',
                  'adicionar_etapa',
                  'criar_tag',
                  'criar_template',
                ],
              },
              nome: { type: 'string' },
              modelo_id: {
                type: 'string',
                description: 'criar_funil: id de um modelo da biblioteca.',
              },
              etapas: {
                type: 'array',
                description: 'criar_funil sem modelo: etapas em ordem.',
                items: {
                  type: 'object',
                  properties: {
                    nome: { type: 'string' },
                    funcao: { type: 'string', enum: FUNCOES.map((f) => f.id) },
                  },
                  required: ['nome', 'funcao'],
                },
              },
              funil: {
                type: 'string',
                description: 'adicionar_etapa: nome do funil existente.',
              },
              funcao: {
                type: 'string',
                enum: FUNCOES.map((f) => f.id),
                description: 'adicionar_etapa: função da etapa.',
              },
              cor: {
                type: 'string',
                description: 'criar_tag: cor #rrggbb (opcional).',
              },
              categoria: { type: 'string', enum: ['Marketing', 'Utility'] },
              idioma: {
                type: 'string',
                description: 'criar_template: padrão pt_BR.',
              },
              corpo: {
                type: 'string',
                description:
                  'criar_template: texto, com {{1}}, {{2}}... se houver variáveis.',
              },
              rodape: { type: 'string' },
              exemplos: {
                type: 'array',
                items: { type: 'string' },
                description: 'Um exemplo por variável, em ordem.',
              },
            },
            required: ['tipo'],
          },
        },
      },
      required: ['resumo', 'acoes'],
    },
  },
  {
    name: 'responder',
    description:
      'Responde no grupo sem executar nada: pergunta o que falta ou explica o que não dá para fazer.',
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string' } },
      required: ['texto'],
    },
  },
];

/** Contexto da conta: o que já existe, para a IA não duplicar nem inventar funil. */
export async function accountContext(
  db: Db,
  accountId: string
): Promise<string> {
  const [acc, pipes, tags, tpls] = await Promise.all([
    db.from('accounts').select('name').eq('id', accountId).maybeSingle(),
    db
      .from('pipelines')
      .select('id, name, pipeline_stages(name, position, funcao)')
      .eq('account_id', accountId),
    db.from('tags').select('name').eq('account_id', accountId).limit(80),
    db
      .from('message_templates')
      .select('name, status')
      .eq('account_id', accountId)
      .limit(80),
  ]);
  const funis = (
    (pipes.data ?? []) as {
      name: string;
      pipeline_stages: { name: string; position: number; funcao: string }[];
    }[]
  )
    .map(
      (p) =>
        `- ${p.name}: ${[...(p.pipeline_stages ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((s) => `${s.name} [${s.funcao}]`)
          .join(' → ')}`
    )
    .join('\n');
  return [
    `Conta: ${acc.data?.name ?? '—'}`,
    `Funis existentes:\n${funis || '(nenhum)'}`,
    `Tags existentes: ${((tags.data ?? []) as { name: string }[]).map((t) => t.name).join(', ') || '(nenhuma)'}`,
    `Templates existentes: ${((tpls.data ?? []) as { name: string; status: string }[]).map((t) => `${t.name} (${t.status})`).join(', ') || '(nenhum)'}`,
    `Funções de etapa: ${FUNCOES.map((f) => `${f.id} = ${f.descricao}`).join(' | ')}`,
    `Modelos de funil da biblioteca: ${MODELOS.map((m) => `${m.id} = ${m.nome} (${m.paraQuem})`).join(' | ')}`,
  ].join('\n\n');
}

export async function planRequest(args: {
  pedido: string;
  contexto: string;
  quemPediu: string;
}): Promise<PlannerOutput & { tokens_in: number; tokens_out: number }> {
  const res = await getAnthropic().messages.create({
    model: MODELO_ANALISE,
    max_tokens: 2000,
    system: systemCacheado(SYSTEM),
    tools: toolsCacheadas(TOOLS),
    tool_choice: { type: 'any' },
    messages: [
      {
        role: 'user',
        content: `${args.contexto}\n\n---\nPedido de ${args.quemPediu} no grupo:\n"""${args.pedido}"""`,
      },
    ],
  });
  const uso = {
    tokens_in: res.usage.input_tokens,
    tokens_out: res.usage.output_tokens,
  };
  const tool = res.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use'
  );
  if (tool?.name === 'propor_plano') {
    const inp = tool.input as { resumo?: string; acoes?: unknown[] };
    return {
      kind: 'plan',
      resumo: inp.resumo ?? '',
      acoes: inp.acoes ?? [],
      ...uso,
    };
  }
  const texto =
    tool?.name === 'responder'
      ? String((tool.input as { texto?: string }).texto ?? '')
      : res.content
          .map((c) => (c.type === 'text' ? c.text : ''))
          .join(' ')
          .trim();
  return {
    kind: 'answer',
    texto: texto || 'Não entendi o pedido. Pode reformular?',
    ...uso,
  };
}
