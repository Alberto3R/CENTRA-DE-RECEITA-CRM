import { describe, expect, it } from 'vitest';
import {
  assignOrigin,
  assignPipeline,
  changedChannels,
  originLabel,
} from './assign';
import {
  classify,
  suggestedChannels,
  type AcquisitionChannel,
  type Touch,
} from './channels';

const canais = (): AcquisitionChannel[] =>
  suggestedChannels().map((c, i) => ({
    ...c,
    id: ['meta', 'org', 'out', 'ind', 'evt'][i],
    account_id: 'a',
  }));

const t = (
  source: string | null,
  utm_source: string | null = null,
  utm_medium: string | null = null
): Touch => ({
  source,
  utm_source,
  utm_medium,
});

describe('originLabel', () => {
  it('traduz as origens que o CRM grava', () => {
    expect(originLabel(t('form', 'ig'))).toBe('Formulário do site · Instagram');
    expect(originLabel(t('ctwa', 'facebook', 'ctwa'))).toBe(
      'Anúncio que abre o WhatsApp · Facebook (anúncio)'
    );
    expect(originLabel(t('meta-leadform-vsc', 'facebook', 'leadform'))).toBe(
      'Formulário dentro do Facebook/Instagram · Facebook (anúncio)'
    );
    expect(originLabel(t('form'))).toBe('Formulário do site');
    expect(originLabel(t(null))).toBe('Origem não informada');
  });
  it('mantém valores desconhecidos como vieram', () => {
    expect(originLabel(t('landing-aula-22set', 'parceiro-x'))).toBe(
      'Página de captura · parceiro-x'
    );
  });
});

describe('assignOrigin', () => {
  it('origem sem canal passa a cair no canal escolhido', () => {
    const o = t('form', 'parceiro-x');
    expect(classify(canais(), o)).toBeNull();
    const next = assignOrigin(canais(), o, 'ind');
    expect(classify(next, o)?.id).toBe('ind');
  });

  it('tira a origem de um canal que já a pegava (mesmo com prioridade maior)', () => {
    // "instagram" está no Meta Ads (posição 0); o usuário diz que é Orgânico.
    const o = t('form', 'instagram', null);
    expect(classify(canais(), o)?.id).toBe('meta');
    const next = assignOrigin(canais(), o, 'org');
    expect(classify(next, o)?.id).toBe('org');
    // e o anúncio pago do Facebook continua no Meta
    expect(classify(next, t('form', 'fb', 'paid'))?.id).toBe('meta');
  });

  it('origem só com source', () => {
    const next = assignOrigin(canais(), t('form'), 'out');
    expect(classify(next, t('form'))?.id).toBe('out');
  });

  it('"Não identificado" tira a origem de todos os canais', () => {
    const next = assignOrigin(canais(), t('ctwa', 'facebook', 'ctwa'), null);
    expect(classify(next, t('ctwa', 'facebook', 'ctwa'))).toBeNull();
  });
});

describe('assignPipeline', () => {
  it('funil passa a contar como um canal, e só um', () => {
    let c = assignPipeline(canais(), 'p1', 'out');
    expect(classify(c, null, 'p1')?.id).toBe('out');
    c = assignPipeline(c, 'p1', 'evt');
    expect(classify(c, null, 'p1')?.id).toBe('evt');
    c = assignPipeline(c, 'p1', null);
    expect(classify(c, null, 'p1')).toBeNull();
  });
});

describe('changedChannels', () => {
  it('só devolve o que mudou', () => {
    const antes = canais();
    const depois = assignPipeline(antes, 'p1', 'out');
    expect(changedChannels(antes, depois).map((c) => c.id)).toEqual(['out']);
  });
});
