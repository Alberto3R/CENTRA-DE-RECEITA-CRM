import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activate, diagnose, isLive, routeFromDiagnosis } from './activation';

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function metaError(
  status: number,
  error: { message: string; code?: number; error_subcode?: number },
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** GET de diagnóstico bem-sucedido, com o estado do número que se quiser. */
function phoneInfo(over: Record<string, unknown> = {}) {
  return ok({
    id: 'PNID_1',
    display_phone_number: '+55 11 99999-0000',
    verified_name: 'Acme',
    code_verification_status: 'VERIFIED',
    platform_type: 'CLOUD_API',
    status: 'CONNECTED',
    ...over,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routeFromDiagnosis', () => {
  const base = {
    phoneNumberId: 'P',
    info: { id: 'P', display_phone_number: '+55' },
  };

  it('VERIFIED + NOT_APPLICABLE → register (CAMINHO A)', () => {
    expect(
      routeFromDiagnosis({
        ...base,
        codeVerificationStatus: 'VERIFIED',
        platformType: 'NOT_APPLICABLE',
        status: '',
      }),
    ).toBe('register');
  });

  it('VERIFIED + CLOUD_API + CONNECTED → nada a fazer', () => {
    expect(
      routeFromDiagnosis({
        ...base,
        codeVerificationStatus: 'VERIFIED',
        platformType: 'CLOUD_API',
        status: 'CONNECTED',
      }),
    ).toBe('already_connected');
  });

  it('VERIFIED + CLOUD_API + DISCONNECTED → register reconecta', () => {
    expect(
      routeFromDiagnosis({
        ...base,
        codeVerificationStatus: 'VERIFIED',
        platformType: 'CLOUD_API',
        status: 'DISCONNECTED',
      }),
    ).toBe('register');
  });

  it('EXPIRED tem precedência sobre qualquer outro campo', () => {
    // Mesmo reportando CONNECTED, um número EXPIRED precisa do código físico
    // antes de qualquer coisa — registrar direto falharia.
    expect(
      routeFromDiagnosis({
        ...base,
        codeVerificationStatus: 'EXPIRED',
        platformType: 'CLOUD_API',
        status: 'CONNECTED',
      }),
    ).toBe('verify_code');
  });

  it('campos omitidos caem no register (lado seguro, pois é idempotente)', () => {
    expect(
      routeFromDiagnosis({
        ...base,
        codeVerificationStatus: '',
        platformType: '',
        status: '',
      }),
    ).toBe('register');
  });
});

describe('diagnose', () => {
  it('resolve direto quando o ID é um Phone Number ID', async () => {
    fetchMock.mockResolvedValueOnce(phoneInfo());
    const result = await diagnose({ id: 'PNID_1', accessToken: 'tok' });
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.diagnosis.phoneNumberId).toBe('PNID_1');
    expect(result.diagnosis.resolvedFromWabaId).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toContain('code_verification_status');
  });

  it('resolve o Phone Number ID quando o cliente manda o WABA ID', async () => {
    // É o erro que a Graph devolve ao pedir campos de número num WABA.
    fetchMock
      .mockResolvedValueOnce(
        metaError(400, {
          message:
            'Tried accessing nonexisting field (display_phone_number) on node type (WhatsAppBusinessAccount)',
          code: 100,
        }),
      )
      .mockResolvedValueOnce(ok({ data: [{ id: 'PNID_REAL' }] }))
      .mockResolvedValueOnce(phoneInfo({ id: 'PNID_REAL' }));

    const result = await diagnose({ id: 'WABA_1', accessToken: 'tok' });
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.diagnosis.phoneNumberId).toBe('PNID_REAL');
    expect(result.diagnosis.resolvedFromWabaId).toBe('WABA_1');
  });

  it('também resolve pelo 100/subcode 33', async () => {
    fetchMock
      .mockResolvedValueOnce(
        metaError(400, {
          message: 'Unsupported get request. Object does not exist',
          code: 100,
          error_subcode: 33,
        }),
      )
      .mockResolvedValueOnce(ok({ data: [{ id: 'PNID_REAL' }] }))
      .mockResolvedValueOnce(phoneInfo({ id: 'PNID_REAL' }));

    const result = await diagnose({ id: 'WABA_1', accessToken: 'tok' });
    expect(result.outcome).toBe('ok');
  });

  it('não escolhe sozinho quando o WABA tem mais de um número', async () => {
    // Escolher errado conectaria o número errado do cliente — precisa parar.
    fetchMock
      .mockResolvedValueOnce(
        metaError(400, { message: 'does not exist', code: 100, error_subcode: 33 }),
      )
      .mockResolvedValueOnce(
        ok({
          data: [
            { id: 'P1', display_phone_number: '+55 11 1111-1111' },
            { id: 'P2', display_phone_number: '+55 11 2222-2222' },
          ],
        }),
      );

    const result = await diagnose({ id: 'WABA_1', accessToken: 'tok' });
    expect(result.outcome).toBe('ambiguous_waba');
    if (result.outcome !== 'ambiguous_waba') return;
    expect(result.candidates).toHaveLength(2);
  });

  it('desempata pelo número informado quando o WABA tem vários', async () => {
    fetchMock
      .mockResolvedValueOnce(
        metaError(400, { message: 'does not exist', code: 100, error_subcode: 33 }),
      )
      .mockResolvedValueOnce(
        ok({
          data: [
            { id: 'P1', display_phone_number: '+55 11 1111-1111' },
            { id: 'P2', display_phone_number: '+55 11 2222-2222' },
          ],
        }),
      )
      .mockResolvedValueOnce(phoneInfo({ id: 'P2' }));

    const result = await diagnose({
      id: 'WABA_1',
      accessToken: 'tok',
      preferPhoneNumber: '+55 (11) 2222-2222',
    });
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.diagnosis.phoneNumberId).toBe('P2');
  });

  it('token inválido → wrong_token_or_bm, sem tentar adivinhar mais nada', async () => {
    fetchMock
      .mockResolvedValueOnce(
        metaError(400, { message: 'does not exist', code: 100, error_subcode: 33 }),
      )
      .mockResolvedValueOnce(metaError(400, { message: 'not a waba', code: 100 }))
      .mockResolvedValueOnce(ok({ data: { is_valid: false, scopes: [] } }));

    const result = await diagnose({ id: 'X', accessToken: 'tok' });
    expect(result.outcome).toBe('wrong_token_or_bm');
    if (result.outcome !== 'wrong_token_or_bm') return;
    expect(result.tokenValid).toBe(false);
  });

  it('token válido sem os escopos → aponta quais faltam', async () => {
    fetchMock
      .mockResolvedValueOnce(
        metaError(400, { message: 'does not exist', code: 100, error_subcode: 33 }),
      )
      .mockResolvedValueOnce(metaError(400, { message: 'not a waba', code: 100 }))
      .mockResolvedValueOnce(
        ok({
          data: { is_valid: true, scopes: ['whatsapp_business_messaging'] },
        }),
      );

    const result = await diagnose({ id: 'X', accessToken: 'tok' });
    expect(result.outcome).toBe('wrong_token_or_bm');
    if (result.outcome !== 'wrong_token_or_bm') return;
    expect(result.missingScopes).toEqual(['whatsapp_business_management']);
  });

  it('token bom mas objeto invisível → lista o que ele administra', async () => {
    fetchMock
      .mockResolvedValueOnce(
        metaError(400, { message: 'does not exist', code: 100, error_subcode: 33 }),
      )
      .mockResolvedValueOnce(metaError(400, { message: 'not a waba', code: 100 }))
      .mockResolvedValueOnce(
        ok({
          data: {
            is_valid: true,
            scopes: [
              'whatsapp_business_management',
              'whatsapp_business_messaging',
            ],
          },
        }),
      )
      .mockResolvedValueOnce(ok({ data: [{ id: 'BM_1', name: 'Acme BM' }] }))
      .mockResolvedValueOnce(ok({ data: [{ id: 'WABA_9' }] }));

    const result = await diagnose({ id: 'X', accessToken: 'tok' });
    expect(result.outcome).toBe('wrong_token_or_bm');
    if (result.outcome !== 'wrong_token_or_bm') return;
    expect(result.tokenValid).toBe(true);
    expect(result.missingScopes).toEqual([]);
    expect(result.reachable).toEqual([
      { businessId: 'BM_1', businessName: 'Acme BM', wabaIds: ['WABA_9'] },
    ]);
  });
});

describe('activate', () => {
  it('não chama /register num número já conectado', async () => {
    fetchMock.mockResolvedValueOnce(phoneInfo());
    const result = await activate({
      id: 'PNID_1',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(result.outcome).toBe('already_connected');
    expect(isLive(result)).toBe(true);
    // Só o GET de diagnóstico — nenhum POST.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('registra quando o número está VERIFIED e desconectado', async () => {
    fetchMock
      .mockResolvedValueOnce(phoneInfo({ status: 'DISCONNECTED' }))
      .mockResolvedValueOnce(ok({ success: true }));

    const result = await activate({
      id: 'PNID_1',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(result.outcome).toBe('registered');
    expect(isLive(result)).toBe(true);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain('/PNID_1/register');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      pin: '123456',
    });
  });

  it('EXPIRED nunca dispara /register', async () => {
    fetchMock.mockResolvedValueOnce(
      phoneInfo({ code_verification_status: 'EXPIRED', status: 'DISCONNECTED' }),
    );
    const result = await activate({
      id: 'PNID_1',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(result.outcome).toBe('needs_code_verification');
    expect(isLive(result)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sem PIN, para em needs_pin em vez de tentar e falhar', async () => {
    fetchMock.mockResolvedValueOnce(phoneInfo({ status: 'DISCONNECTED' }));
    const result = await activate({ id: 'PNID_1', accessToken: 'tok', pin: null });
    expect(result.outcome).toBe('needs_pin');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('erro de 2SV vira needs_old_pin, não erro genérico', async () => {
    fetchMock
      .mockResolvedValueOnce(phoneInfo({ status: 'DISCONNECTED' }))
      .mockResolvedValueOnce(
        metaError(400, {
          message: 'Two-step verification PIN required.',
          code: 133007,
        }),
      );
    const result = await activate({
      id: 'PNID_1',
      accessToken: 'tok',
      pin: '000000',
    });
    expect(result.outcome).toBe('needs_old_pin');
    if (result.outcome !== 'needs_old_pin') return;
    expect(result.message).toMatch(/PIN ANTIGO/);
  });

  it('já registrado neste app conta como sucesso', async () => {
    fetchMock
      .mockResolvedValueOnce(phoneInfo({ status: 'DISCONNECTED' }))
      .mockResolvedValueOnce(
        metaError(400, {
          message: 'Phone number is already registered to this app.',
          code: 133005,
        }),
      );
    const result = await activate({
      id: 'PNID_1',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(result.outcome).toBe('registered');
    if (result.outcome !== 'registered') return;
    expect(result.alreadyRegistered).toBe(true);
  });

  it('133010 no register explica a conta ativa no celular', async () => {
    fetchMock
      .mockResolvedValueOnce(phoneInfo({ status: 'DISCONNECTED' }))
      .mockResolvedValueOnce(
        metaError(400, { message: 'Phone number not registered', code: 133010 }),
      );
    const result = await activate({
      id: 'PNID_1',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(result.outcome).toBe('meta_error');
    if (result.outcome !== 'meta_error') return;
    expect(result.message).toMatch(/Excluir minha conta/);
  });

  it('repassa o diagnóstico ruim sem tentar registrar', async () => {
    fetchMock
      .mockResolvedValueOnce(
        metaError(400, { message: 'does not exist', code: 100, error_subcode: 33 }),
      )
      .mockResolvedValueOnce(metaError(400, { message: 'not a waba', code: 100 }))
      .mockResolvedValueOnce(ok({ data: { is_valid: false, scopes: [] } }));

    const result = await activate({
      id: 'X',
      accessToken: 'tok',
      pin: '123456',
    });
    expect(result.outcome).toBe('wrong_token_or_bm');
    expect(isLive(result)).toBe(false);
  });
});
