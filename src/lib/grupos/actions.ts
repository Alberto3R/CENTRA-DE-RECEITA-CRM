// Ações que o agente de grupo pode executar — LISTA FECHADA, só criação.
// Nada aqui apaga, renomeia ou dispara mensagem para lead: o pior caso de um
// mal-entendido é um funil/etapa/tag/template a mais, que se apaga na mão.
//
// Fluxo: a IA devolve um plano (lista de ações) → validatePlan() normaliza e
// rejeita o que não cabe → describePlan() vira o texto do "Confirma?" → no
// "ok", executePlan() roda as ações em ordem, com as funções do próprio CRM.

import { FUNCOES, funcaoInfo, type FuncaoEtapa } from '@/lib/pipelines/funcoes';

export const FUNCAO_IDS = FUNCOES.map((f) => f.id) as FuncaoEtapa[];

export type GroupAction =
  | {
      tipo: 'criar_funil';
      nome: string;
      modelo_id?: string;
      etapas?: { nome: string; funcao: FuncaoEtapa }[];
    }
  | {
      tipo: 'adicionar_etapa';
      funil: string;
      nome: string;
      funcao: FuncaoEtapa;
    }
  | { tipo: 'criar_tag'; nome: string; cor?: string }
  | {
      tipo: 'criar_template';
      nome: string;
      categoria: 'Marketing' | 'Utility';
      idioma: string;
      corpo: string;
      rodape?: string;
      exemplos?: string[];
    };

export interface PlanError {
  indice: number;
  erro: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Normaliza o nome de template para o formato que a Meta aceita. */
export function templateName(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
}

/** Variáveis {{1}}, {{2}}... do corpo do template. */
export function bodyVariables(corpo: string): number[] {
  return [
    ...new Set([...corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))),
  ].sort((a, b) => a - b);
}

/**
 * Valida e normaliza o que veio da IA. Devolve as ações aceitas e os erros
 * (por índice) — o agente explica no grupo o que não deu para planejar.
 */
export function validatePlan(
  raw: unknown,
  modelosValidos: string[] = []
): { acoes: GroupAction[]; erros: PlanError[] } {
  const acoes: GroupAction[] = [];
  const erros: PlanError[] = [];
  const lista = Array.isArray(raw) ? raw.slice(0, 10) : [];
  lista.forEach((a: Record<string, unknown>, i) => {
    const tipo = str(a?.tipo);
    if (tipo === 'criar_funil') {
      const nome = str(a.nome);
      if (!nome) return erros.push({ indice: i, erro: 'funil sem nome' });
      const modelo_id = str(a.modelo_id) || undefined;
      if (modelo_id && !modelosValidos.includes(modelo_id)) {
        return erros.push({
          indice: i,
          erro: `modelo de funil "${modelo_id}" não existe`,
        });
      }
      const etapasRaw = Array.isArray(a.etapas) ? a.etapas : [];
      const etapas = etapasRaw
        .map((e: Record<string, unknown>) => ({
          nome: str(e?.nome),
          funcao: str(e?.funcao) as FuncaoEtapa,
        }))
        .filter((e) => e.nome);
      if (etapas.some((e) => !FUNCAO_IDS.includes(e.funcao))) {
        return erros.push({ indice: i, erro: 'etapa com função inválida' });
      }
      if (!modelo_id && etapas.length < 2) {
        return erros.push({
          indice: i,
          erro: 'funil precisa de pelo menos 2 etapas ou de um modelo',
        });
      }
      acoes.push({ tipo, nome, ...(modelo_id ? { modelo_id } : { etapas }) });
    } else if (tipo === 'adicionar_etapa') {
      const funil = str(a.funil);
      const nome = str(a.nome);
      const funcao = str(a.funcao) as FuncaoEtapa;
      if (!funil || !nome)
        return erros.push({ indice: i, erro: 'etapa sem funil ou sem nome' });
      if (!FUNCAO_IDS.includes(funcao))
        return erros.push({ indice: i, erro: 'etapa com função inválida' });
      acoes.push({ tipo, funil, nome, funcao });
    } else if (tipo === 'criar_tag') {
      const nome = str(a.nome);
      if (!nome) return erros.push({ indice: i, erro: 'tag sem nome' });
      const cor = /^#[0-9a-f]{6}$/i.test(str(a.cor)) ? str(a.cor) : undefined;
      acoes.push({ tipo, nome, ...(cor ? { cor } : {}) });
    } else if (tipo === 'criar_template') {
      const nome = templateName(str(a.nome));
      const corpo = str(a.corpo);
      const categoria =
        str(a.categoria) === 'Marketing'
          ? 'Marketing'
          : str(a.categoria) === 'Utility'
            ? 'Utility'
            : null;
      if (!nome || !corpo)
        return erros.push({
          indice: i,
          erro: 'template sem nome ou sem texto',
        });
      if (!categoria)
        return erros.push({
          indice: i,
          erro: 'template precisa ser Marketing ou Utility',
        });
      if (corpo.length > 1024)
        return erros.push({
          indice: i,
          erro: 'texto do template passa de 1024 caracteres',
        });
      // A Meta recusa variável no começo/fim do corpo e exige exemplo de cada uma.
      if (/^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*[.!?]?\s*$/.test(corpo)) {
        return erros.push({
          indice: i,
          erro: 'o texto não pode começar nem terminar com uma variável {{n}}',
        });
      }
      const vars = bodyVariables(corpo);
      const exemplos = (Array.isArray(a.exemplos) ? a.exemplos : [])
        .map((x) => str(x))
        .filter(Boolean);
      if (vars.length && exemplos.length < vars.length) {
        return erros.push({
          indice: i,
          erro: `faltam exemplos para as variáveis ${vars.map((v) => `{{${v}}}`).join(', ')}`,
        });
      }
      acoes.push({
        tipo,
        nome,
        categoria,
        idioma: str(a.idioma) || 'pt_BR',
        corpo,
        ...(str(a.rodape) ? { rodape: str(a.rodape) } : {}),
        ...(vars.length ? { exemplos: exemplos.slice(0, vars.length) } : {}),
      });
    } else {
      erros.push({ indice: i, erro: `ação "${tipo || '?'}" não é permitida` });
    }
  });
  return { acoes, erros };
}

/** Texto do plano para o "Confirma?" no grupo (formatação do WhatsApp). */
export function describePlan(
  acoes: GroupAction[],
  modeloNome: (id: string) => string = (id) => id
): string {
  return acoes
    .map((a, i) => {
      const n = `${i + 1}.`;
      switch (a.tipo) {
        case 'criar_funil':
          return a.modelo_id
            ? `${n} Criar o funil *${a.nome}* a partir do modelo _${modeloNome(a.modelo_id)}_`
            : `${n} Criar o funil *${a.nome}* com as etapas: ${a.etapas!.map((e) => `${e.nome} (${funcaoInfo(e.funcao).label})`).join(' → ')}`;
        case 'adicionar_etapa':
          return `${n} Adicionar a etapa *${a.nome}* (${funcaoInfo(a.funcao).label}) no funil _${a.funil}_`;
        case 'criar_tag':
          return `${n} Criar a tag *${a.nome}*`;
        case 'criar_template':
          return `${n} Criar o template *${a.nome}* (${a.categoria === 'Marketing' ? 'Marketing' : 'Utilidade'}) e enviar para aprovação da Meta:\n   "${a.corpo}"${a.rodape ? `\n   _${a.rodape}_` : ''}`;
      }
    })
    .join('\n');
}
