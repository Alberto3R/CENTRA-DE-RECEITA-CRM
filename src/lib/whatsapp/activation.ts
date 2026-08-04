/**
 * Ativação de número na WhatsApp Cloud API.
 *
 * O cliente entrega token + ID e espera que o número saia de "Pendente" para
 * "Conectado". O caminho até lá depende do ESTADO do número, e o estado só se
 * descobre perguntando à Meta. Por isso este módulo nunca dispara /register
 * cego: sempre diagnostica primeiro e roteia.
 *
 *   diagnose()  → resolve o ID (pode ser WABA ID) e lê o estado real
 *   activate()  → diagnostica e, quando dá, registra
 *
 * Todo resultado é uma union discriminada com `outcome`, para a rota HTTP e a
 * UI decidirem o que mostrar sem reinterpretar mensagens de erro da Meta.
 *
 * Regra que atravessa o arquivo: nada aqui inventa estado. Quando a Meta não
 * dá para concluir (número em outro BM, linha física fora de alcance, PIN
 * antigo perdido), o resultado diz explicitamente que precisa de humano — é
 * melhor parar do que fingir que conectou.
 */

import {
  MetaApiError,
  debugToken,
  isNotRegisteredError,
  isPinError,
  listBusinesses,
  listOwnedWabas,
  listWabaPhoneNumbers,
  missingTokenScopes,
  registerPhoneNumber,
  verifyPhoneNumber,
  type MetaPhoneInfo,
} from './meta-api'

/** Estado do número como a Meta reporta, já normalizado. */
export interface PhoneDiagnosis {
  /** Phone Number ID real — pode diferir do ID que o cliente informou. */
  phoneNumberId: string
  /** Preenchido quando o ID informado era, na verdade, o WABA ID. */
  resolvedFromWabaId?: string
  info: MetaPhoneInfo
  codeVerificationStatus: string
  platformType: string
  status: string
}

export type DiagnoseResult =
  | { outcome: 'ok'; diagnosis: PhoneDiagnosis }
  /**
   * O ID informado era um WABA ID com MAIS DE UM número. Não dá para escolher
   * por conta própria — a escolha errada conecta o número errado do cliente.
   */
  | {
      outcome: 'ambiguous_waba'
      wabaId: string
      candidates: { id: string; display_phone_number?: string; verified_name?: string }[]
      message: string
    }
  /** Nem Phone Number ID, nem WABA ID que este token alcance. */
  | {
      outcome: 'wrong_token_or_bm'
      message: string
      tokenValid: boolean
      missingScopes: string[]
      /** WABAs/números que o token REALMENTE administra, p/ o cliente comparar. */
      reachable: { businessId: string; businessName?: string; wabaIds: string[] }[]
    }

export type ActivationResult =
  /** Já estava conectado antes da gente mexer. Nada a fazer. */
  | { outcome: 'already_connected'; diagnosis: PhoneDiagnosis }
  /** /register respondeu success — o número está no ar. */
  | { outcome: 'registered'; diagnosis: PhoneDiagnosis; alreadyRegistered: boolean }
  /** VERIFIED mas sem PIN informado — não dá para registrar. */
  | { outcome: 'needs_pin'; diagnosis: PhoneDiagnosis; message: string }
  /** O número já tinha PIN; o informado não bate. Só o PIN antigo resolve. */
  | { outcome: 'needs_old_pin'; diagnosis: PhoneDiagnosis; message: string }
  /** EXPIRED — exige código físico (SMS/ligação) antes do /register. */
  | { outcome: 'needs_code_verification'; diagnosis: PhoneDiagnosis; message: string }
  /** Falha da Meta que não se encaixa em nenhum caminho conhecido. */
  | { outcome: 'meta_error'; diagnosis: PhoneDiagnosis | null; message: string }
  | Exclude<DiagnoseResult, { outcome: 'ok' }>

const CONNECTED = 'CONNECTED'
const CLOUD_API = 'CLOUD_API'
const VERIFIED = 'VERIFIED'
const EXPIRED = 'EXPIRED'

function toDiagnosis(
  phoneNumberId: string,
  info: MetaPhoneInfo,
  resolvedFromWabaId?: string
): PhoneDiagnosis {
  return {
    phoneNumberId,
    resolvedFromWabaId,
    info,
    // A Meta omite esses campos em alguns números (test numbers, sobretudo).
    // Normalizar para string vazia evita `undefined` vazando pro roteamento —
    // o default cai no caminho conservador (tenta registrar), não no "já ok".
    codeVerificationStatus: info.code_verification_status ?? '',
    platformType: info.platform_type ?? '',
    status: info.status ?? '',
  }
}

/**
 * PASSO 1 + 1B — descobre qual é o Phone Number ID e em que estado ele está.
 *
 * Nunca muda estado na Meta: só GETs. Pode ser chamado à vontade.
 */
export async function diagnose(args: {
  id: string
  accessToken: string
  /**
   * Quando o ID é um WABA com vários números, este filtro escolhe qual.
   * Recebe o display_phone_number normalizado (só dígitos).
   */
  preferPhoneNumber?: string
}): Promise<DiagnoseResult> {
  const { id, accessToken, preferPhoneNumber } = args

  try {
    const info = await verifyPhoneNumber({ phoneNumberId: id, accessToken })
    return { outcome: 'ok', diagnosis: toDiagnosis(id, info) }
  } catch (err) {
    // Qualquer erro que NÃO seja "esse objeto não existe pra você" é problema
    // real e não adianta tentar o PASSO 1B — repassa.
    if (!(err instanceof MetaApiError) || !err.isObjectNotVisible) {
      throw err
    }
  }

  // PASSO 1B — o ID pode ser um WABA ID.
  let numbers: Awaited<ReturnType<typeof listWabaPhoneNumbers>> = []
  try {
    numbers = await listWabaPhoneNumbers({ wabaId: id, accessToken })
  } catch {
    // Também não é WABA (ou o token não o vê). Cai no diagnóstico de token.
    numbers = []
  }

  if (numbers.length > 0) {
    const picked = pickNumber(numbers, preferPhoneNumber)
    if (!picked) {
      return {
        outcome: 'ambiguous_waba',
        wabaId: id,
        candidates: numbers.map((n) => ({
          id: n.id,
          display_phone_number: n.display_phone_number,
          verified_name: n.verified_name,
        })),
        message:
          'O ID informado é um WABA ID com mais de um número. Escolha qual número deve ser ativado.',
      }
    }
    // Rediagnostica no Phone Number ID real — o /phone_numbers traz os campos,
    // mas relemos pelo caminho canônico para não depender do shape da lista.
    const info = await verifyPhoneNumber({
      phoneNumberId: picked.id,
      accessToken,
    })
    return { outcome: 'ok', diagnosis: toDiagnosis(picked.id, info, id) }
  }

  return diagnoseToken(accessToken)
}

function pickNumber(
  numbers: { id: string; display_phone_number?: string }[],
  preferPhoneNumber?: string
): { id: string; display_phone_number?: string } | null {
  if (numbers.length === 1) return numbers[0]
  if (!preferPhoneNumber) return null
  const wanted = preferPhoneNumber.replace(/\D/g, '')
  if (!wanted) return null
  const match = numbers.find(
    (n) => (n.display_phone_number ?? '').replace(/\D/g, '') === wanted
  )
  return match ?? null
}

/**
 * O ID não resolveu por nenhum caminho. Descobre se o problema é o token
 * (inválido/sem escopo) ou o BM (número em portfólio que o System User não
 * administra) e devolve o que o token REALMENTE alcança, para o cliente
 * comparar com o que ele acha que mandou.
 */
async function diagnoseToken(accessToken: string): Promise<DiagnoseResult> {
  let tokenValid = false
  let missing: string[] = []
  try {
    const info = await debugToken({ accessToken })
    tokenValid = info.is_valid
    missing = missingTokenScopes(info.scopes)
  } catch {
    // debug_token falhou — trata como token inválido, é a conclusão útil.
  }

  if (!tokenValid) {
    return {
      outcome: 'wrong_token_or_bm',
      tokenValid: false,
      missingScopes: missing,
      reachable: [],
      message:
        'O token de acesso é inválido ou expirou. Gere um novo token de System User no Gerenciador de Negócios da Meta.',
    }
  }

  if (missing.length > 0) {
    return {
      outcome: 'wrong_token_or_bm',
      tokenValid: true,
      missingScopes: missing,
      reachable: [],
      message: `O token é válido mas não tem as permissões necessárias: ${missing.join(
        ', '
      )}. Gere um novo token com esses escopos marcados.`,
    }
  }

  // Token bom, objeto invisível: é questão de BM/portfólio. Levanta o que ele
  // administra — sem isso o cliente fica adivinhando qual BM usar.
  const reachable: { businessId: string; businessName?: string; wabaIds: string[] }[] = []
  try {
    const businesses = await listBusinesses({ accessToken })
    for (const biz of businesses) {
      try {
        const wabas = await listOwnedWabas({ businessId: biz.id, accessToken })
        reachable.push({
          businessId: biz.id,
          businessName: biz.name,
          wabaIds: wabas.map((w) => w.id),
        })
      } catch {
        reachable.push({ businessId: biz.id, businessName: biz.name, wabaIds: [] })
      }
    }
  } catch {
    // Sem a lista, a mensagem abaixo ainda diz o essencial.
  }

  return {
    outcome: 'wrong_token_or_bm',
    tokenValid: true,
    missingScopes: [],
    reachable,
    message:
      'O token é válido, mas esse número não está em nenhum portfólio que ele administra. É preciso gerar o token no Gerenciador de Negócios correto OU atribuir esse WABA ao System User do token.',
  }
}

/**
 * PASSO 2 — decide o caminho a partir do estado do número.
 *
 * Separado de `activate` porque é pura decisão: dá para testar a tabela de
 * roteamento inteira sem tocar em rede.
 */
export function routeFromDiagnosis(
  diagnosis: PhoneDiagnosis
): 'already_connected' | 'register' | 'verify_code' {
  if (diagnosis.codeVerificationStatus === EXPIRED) return 'verify_code'
  if (
    diagnosis.codeVerificationStatus === VERIFIED &&
    diagnosis.platformType === CLOUD_API &&
    diagnosis.status === CONNECTED
  ) {
    return 'already_connected'
  }
  // Todo o resto — VERIFIED/NOT_APPLICABLE, CLOUD_API/DISCONNECTED, ou campos
  // que a Meta omitiu — resolve com /register. Re-registrar um número já
  // conectado é idempotente, então errar para este lado é seguro.
  return 'register'
}

/**
 * Diagnostica e ativa. É o ponto de entrada do save.
 *
 * `pin` é opcional porque números de teste da Meta não têm 2SV para informar;
 * sem PIN a função devolve `needs_pin` em vez de tentar e falhar.
 */
export async function activate(args: {
  id: string
  accessToken: string
  pin?: string | null
  preferPhoneNumber?: string
}): Promise<ActivationResult> {
  const { id, accessToken, pin, preferPhoneNumber } = args

  let diag: DiagnoseResult
  try {
    diag = await diagnose({ id, accessToken, preferPhoneNumber })
  } catch (err) {
    return {
      outcome: 'meta_error',
      diagnosis: null,
      message: err instanceof Error ? err.message : String(err),
    }
  }

  if (diag.outcome !== 'ok') return diag

  const diagnosis = diag.diagnosis
  const route = routeFromDiagnosis(diagnosis)

  if (route === 'already_connected') {
    return { outcome: 'already_connected', diagnosis }
  }

  if (route === 'verify_code') {
    return {
      outcome: 'needs_code_verification',
      diagnosis,
      message:
        'A verificação deste número expirou. Para reativar, a Meta envia um código por SMS ou ligação PARA O PRÓPRIO NÚMERO — é preciso que alguém tenha acesso à linha para receber e informar o código.',
    }
  }

  if (!pin) {
    return {
      outcome: 'needs_pin',
      diagnosis,
      message:
        'Informe o PIN de verificação em duas etapas (6 dígitos) para ativar o número. Se o número já teve um PIN definido antes, use o PIN antigo.',
    }
  }

  return registerWithPin(diagnosis, accessToken, pin)
}

/**
 * Chama /register e traduz a resposta.
 *
 * Exportado porque o CAMINHO B termina exatamente aqui (B3): depois do
 * verify_code, a rota reusa esta função em vez de repetir o tratamento de erro.
 */
export async function registerWithPin(
  diagnosis: PhoneDiagnosis,
  accessToken: string,
  pin: string
): Promise<ActivationResult> {
  try {
    const result = await registerPhoneNumber({
      phoneNumberId: diagnosis.phoneNumberId,
      accessToken,
      pin,
    })
    return {
      outcome: 'registered',
      diagnosis,
      alreadyRegistered: result.alreadyRegistered,
    }
  } catch (err) {
    if (isPinError(err)) {
      return {
        outcome: 'needs_old_pin',
        diagnosis,
        message:
          'A Meta recusou o PIN. Se este número já teve verificação em duas etapas ativada, só o PIN ANTIGO funciona — não é possível definir um novo agora. Sem ele, o reset do 2SV leva 7 dias ou precisa passar pelo suporte da Meta.',
      }
    }
    if (isNotRegisteredError(err)) {
      // 133010 no próprio /register: o registro está solto do lado da Meta.
      // Ainda assim é uma falha de ativação — mas a causa costuma ser conta
      // de WhatsApp ativa no celular segurando o número.
      return {
        outcome: 'meta_error',
        diagnosis,
        message:
          'A Meta respondeu 133010 (número não registrado) durante o registro. Verifique se ainda existe uma conta do WhatsApp ativa neste número no celular — é preciso excluí-la no app (Configurações → Conta → Excluir minha conta) antes de registrar na Cloud API.',
      }
    }
    return {
      outcome: 'meta_error',
      diagnosis,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * O número está no ar? Único lugar que decide isso, para a coluna `status` do
 * banco parar de divergir da Meta (antes, um save sem PIN gravava
 * 'connected' mesmo sem nunca ter registrado).
 */
export function isLive(result: ActivationResult): boolean {
  return result.outcome === 'already_connected' || result.outcome === 'registered'
}
