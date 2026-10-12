import { describe, expect, it } from 'vitest';
import {
  extractLinkCode,
  isCancel,
  isConfirm,
  isMention,
  newLinkCode,
  stripMentions,
} from './text';

const BOT = '5561999990000';

describe('isMention', () => {
  it('reconhece @número do agente', () => {
    expect(isMention('@5561999990000 cria um funil Pós-venda', [BOT])).toBe(
      true
    );
  });
  it('reconhece @número sem o 55', () => {
    expect(isMention('@61999990000 cria um funil', [BOT])).toBe(true);
  });
  it('reconhece o lid do agente', () => {
    expect(isMention('@204857362811234 oi', [BOT, '204857362811234'])).toBe(
      true
    );
  });
  it('reconhece o apelido @assistente', () => {
    expect(isMention('@Assistente cria a tag VIP', [BOT])).toBe(true);
  });
  it('não confunde com marcação de outra pessoa', () => {
    expect(isMention('@5561988887777 você viu?', [BOT])).toBe(false);
    expect(isMention('fala com o assistente depois', [BOT])).toBe(false);
  });
});

describe('stripMentions', () => {
  it('tira as marcações e deixa o pedido', () => {
    expect(stripMentions('@5561999990000  cria um funil')).toBe(
      'cria um funil'
    );
    expect(stripMentions('@assistente ok')).toBe('ok');
  });
});

describe('isConfirm / isCancel', () => {
  it.each([
    'ok',
    'Ok!',
    'sim',
    'pode',
    'manda ver',
    '@assistente confirma',
    '👍',
  ])('"%s" confirma', (t) => {
    expect(isConfirm(t)).toBe(true);
  });
  it.each(['ok, mas troca o nome', 'pode ser amanhã?', 'cria outro funil'])(
    '"%s" não é confirmação seca',
    (t) => {
      expect(isConfirm(t)).toBe(false);
    }
  );
  it.each(['não', 'nao', 'cancela', 'esquece'])('"%s" cancela', (t) => {
    expect(isCancel(t)).toBe(true);
  });
});

describe('códigos de vínculo', () => {
  it('extrai em qualquer caixa', () => {
    expect(extractLinkCode('@assistente vincular-4f7k2q por favor')).toBe(
      'VINCULAR-4F7K2Q'
    );
    expect(extractLinkCode('sem código')).toBeNull();
  });
  it('gera no formato aceito pela migration', () => {
    expect(newLinkCode()).toMatch(/^VINCULAR-[A-Z0-9]{6}$/);
    expect(newLinkCode(() => 0)).toBe('VINCULAR-AAAAAA');
  });
});
