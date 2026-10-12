import { describe, expect, it } from 'vitest';
import {
  bodyVariables,
  describePlan,
  templateName,
  validatePlan,
} from './actions';

describe('templateName', () => {
  it('vira minúsculas_com_underline, sem acento', () => {
    expect(templateName('Lembrete de Reunião — Amanhã')).toBe(
      'lembrete_de_reuniao_amanha'
    );
  });
});

describe('bodyVariables', () => {
  it('lista as variáveis sem repetir', () => {
    expect(bodyVariables('Oi {{1}}, sua aula é {{2}}. Até {{1}}!')).toEqual([
      1, 2,
    ]);
  });
});

describe('validatePlan', () => {
  it('aceita funil com etapas e funções válidas', () => {
    const { acoes, erros } = validatePlan([
      {
        tipo: 'criar_funil',
        nome: 'Pós-venda',
        etapas: [
          { nome: 'Onboarding', funcao: 'entrada' },
          { nome: 'Ativo', funcao: 'ganho' },
          { nome: 'Cancelou', funcao: 'perdido' },
        ],
      },
    ]);
    expect(erros).toEqual([]);
    expect(acoes[0]).toMatchObject({ tipo: 'criar_funil', nome: 'Pós-venda' });
  });

  it('aceita funil por modelo só se o modelo existir', () => {
    expect(
      validatePlan(
        [{ tipo: 'criar_funil', nome: 'X', modelo_id: 'geral-3r' }],
        ['geral-3r']
      ).acoes
    ).toHaveLength(1);
    expect(
      validatePlan(
        [{ tipo: 'criar_funil', nome: 'X', modelo_id: 'inventado' }],
        ['geral-3r']
      ).erros
    ).toHaveLength(1);
  });

  it('recusa função de etapa inventada', () => {
    const r = validatePlan([
      {
        tipo: 'adicionar_etapa',
        funil: 'Vendas',
        nome: 'Follow',
        funcao: 'followup',
      },
    ]);
    expect(r.acoes).toHaveLength(0);
    expect(r.erros[0].erro).toMatch(/função/);
  });

  it('recusa ação fora da lista (ex.: apagar)', () => {
    const r = validatePlan([{ tipo: 'apagar_funil', nome: 'Vendas' }]);
    expect(r.erros[0].erro).toMatch(/não é permitida/);
  });

  it('template: normaliza nome, exige exemplos e recusa variável no fim', () => {
    const ok = validatePlan([
      {
        tipo: 'criar_template',
        nome: 'Lembrete Aula',
        categoria: 'Utility',
        corpo: 'Oi {{1}}, sua aula começa às {{2}}. Te espero!',
        exemplos: ['Ana', '19h'],
      },
    ]);
    expect(ok.acoes[0]).toMatchObject({
      nome: 'lembrete_aula',
      idioma: 'pt_BR',
      exemplos: ['Ana', '19h'],
    });

    expect(
      validatePlan([
        {
          tipo: 'criar_template',
          nome: 'a',
          categoria: 'Utility',
          corpo: 'Oi {{1}}, tudo bem?',
        },
      ]).erros[0].erro
    ).toMatch(/exemplos/);
    expect(
      validatePlan([
        {
          tipo: 'criar_template',
          nome: 'a',
          categoria: 'Utility',
          corpo: 'Seu código é {{1}}',
          exemplos: ['x'],
        },
      ]).erros[0].erro
    ).toMatch(/terminar/);
    expect(
      validatePlan([
        {
          tipo: 'criar_template',
          nome: 'a',
          categoria: 'Authentication',
          corpo: 'Oi',
        },
      ]).erros[0].erro
    ).toMatch(/Marketing ou Utility/);
  });

  it('limita a 10 ações', () => {
    const muitas = Array.from({ length: 15 }, (_, i) => ({
      tipo: 'criar_tag',
      nome: `t${i}`,
    }));
    expect(validatePlan(muitas).acoes).toHaveLength(10);
  });
});

describe('describePlan', () => {
  it('escreve o plano numerado em português', () => {
    const { acoes } = validatePlan([
      { tipo: 'criar_tag', nome: 'Cliente VIP' },
      {
        tipo: 'adicionar_etapa',
        funil: 'Vendas',
        nome: 'Reunião marcada',
        funcao: 'compromisso',
      },
    ]);
    const t = describePlan(acoes);
    expect(t).toContain('1. Criar a tag *Cliente VIP*');
    expect(t).toContain(
      '2. Adicionar a etapa *Reunião marcada* (Compromisso) no funil _Vendas_'
    );
  });
});
