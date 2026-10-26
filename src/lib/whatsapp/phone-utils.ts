/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Telefone digitado num formulário brasileiro → forma canônica da Meta
 * (55 + DDD + número, só dígitos).
 *
 * Quem preenche "(81) 99999-9999" manda 11 dígitos sem o 55. Guardado
 * assim, a Meta lê o DDD como código de país (81 = Japão, 51 = Peru,
 * 62 = Indonésia, 34 = Espanha) e o template volta 131026; e a resposta
 * do lead pelo WhatsApp chega como 5581… e não casa com o contato.
 *
 * Regra: só o comprimento decide, nunca o prefixo (DDD 55 existe —
 * Santa Maria/RS). 10 ou 11 dígitos = número brasileiro sem DDI → ganha o
 * 55. Com "+" na frente o número já veio internacional e fica como está.
 * Um 0 de tronco ("011 9…") é descartado antes.
 */
export function normalizeBrPhone(raw: string): string {
  if (!raw) return ''
  const international = raw.trim().startsWith('+')
  let d = normalizePhone(raw)
  if (international) return d
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}

/**
 * Chaves de busca de um contato para o telefone de formulário: a canônica
 * primeiro e, se ela tem o 55 do Brasil, também a versão sem ele — é assim
 * que ficaram os contatos gravados antes da normalização.
 */
export function brPhoneLookupKeys(raw: string): string[] {
  const canonical = normalizeBrPhone(raw)
  if (!canonical) return []
  const keys = [canonical]
  if (canonical.startsWith('55') && (canonical.length === 12 || canonical.length === 13)) {
    keys.push(canonical.slice(2))
  }
  return keys
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true
  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Detect a WhatsApp Business-Scoped User ID (BSUID).
 *
 * Com o lançamento dos usernames do WhatsApp (obrigatório ~jun/2026), o
 * remetente pode chegar identificado por um BSUID em vez do telefone —
 * formato: prefixo de país de 2 letras + ponto + alfanumérico
 * (ex.: "BR.13491208655302741918", "US.1349..."). Telefones são só
 * dígitos, então o ponto + letras distingue com segurança. O BSUID é
 * aceito no campo `to` de envio igual a um telefone (exceto templates de
 * autenticação, que exigem telefone — erro 131062).
 */
export function isBsuid(id: string | null | undefined): boolean {
  if (!id) return false
  return /^[A-Za-z]{2}\.[A-Za-z0-9_-]{4,128}$/.test(id)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}
