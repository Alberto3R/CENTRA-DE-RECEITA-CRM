import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { subscribeWabaToApp, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { activate, isLive, type ActivationResult } from '@/lib/whatsapp/activation'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/**
 * Resolve the caller's account_id from their profile. Inlined here
 * (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// Lazy-initialised service-role client. We need it to detect a
// phone_number_id already claimed by a *different* user — under RLS,
// the user's own session can't see other users' rows, so the conflict
// would be invisible without the service role.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * Um phone_number_id já pertence a OUTRA conta desta instância?
 *
 * Devolve 'error' em vez de lançar para o chamador escolher o status HTTP —
 * um erro de consulta aqui não é o mesmo que um conflito confirmado, e tratar
 * os dois igual esconderia falha de infraestrutura como se fosse conflito.
 */
async function isClaimedByAnotherAccount(
  phoneNumberId: string,
  accountId: string,
): Promise<boolean | 'error'> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('Error checking phone_number_id ownership:', error)
    return 'error'
  }
  return data != null
}

/**
 * Traduz o resultado da ativação no corpo da resposta HTTP.
 *
 * Um objeto só, com `activation.outcome` discriminando, para a UI decidir o
 * que renderizar sem inspecionar mensagem de erro. Os campos legados
 * (`registered`, `registration_error`) continuam preenchidos para não quebrar
 * quem já consome esta rota.
 */
function activationPayload(result: ActivationResult) {
  const live = isLive(result)
  return {
    activation: result,
    registered: live,
    registration_error:
      result.outcome === 'meta_error' || result.outcome === 'needs_old_pin'
        ? result.message
        : null,
    phone_info: 'diagnosis' in result ? (result.diagnosis?.info ?? null) : null,
  }
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    // Multi-canal: checa a saúde de um canal específico (?channelId=) ou do
    // primário. Antes era .maybeSingle() por conta — quebraria com >1 canal.
    const channelId = new URL(request.url).searchParams.get('channelId')
    let cfgQuery = supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token, status')
      .eq('account_id', accountId)
    cfgQuery = channelId
      ? cfgQuery.eq('id', channelId)
      : cfgQuery.eq('is_primary', true)
    const { data: config, error: configError } = await cfgQuery.maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({ connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token, pin, app_secret } = body
    // Multi-canal: `channelId` = editar um canal existente; `isNew` = adicionar
    // um novo canal; `label` = rótulo do canal. Sem nenhum → edita o primário
    // (retrocompatível com o fluxo de 1 canal).
    const channelId: string | null =
      typeof body.channelId === 'string' ? body.channelId : null
    const isNew: boolean = body.isNew === true
    const label: string | null =
      typeof body.label === 'string' && body.label.trim()
        ? body.label.trim().slice(0, 60)
        : null

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        )
      }
    }

    // Reject if another account has already claimed this phone_number_id.
    // wacrm is single-tenant-per-WhatsApp-number — letting two accounts
    // bind the same number causes the webhook's `.single()` lookup to
    // throw PGRST116 ("multiple rows"), silently dropping every
    // inbound message. See issue #136. Post-multi-user we key on
    // account_id (not user_id) since teammates inside the same account
    // all share one config; the conflict is between accounts.
    //
    // Roda duas vezes: aqui, no ID que o cliente digitou, e de novo depois da
    // ativação, no Phone Number ID que a Meta resolveu — porque o cliente pode
    // ter colado o WABA ID, e é o ID resolvido que vai pro banco.
    const claimedCheck = await isClaimedByAnotherAccount(phone_number_id, accountId)
    if (claimedCheck === 'error') {
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 }
      )
    }
    if (claimedCheck === true) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
        },
        { status: 409 }
      )
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    let encryptedAppSecret: string | null
    // O PIN entra aqui junto com os demais segredos: é credencial permanente
    // (exigida em toda re-conexão), então nunca vai para o banco em claro.
    let encryptedPin: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
      encryptedAppSecret = app_secret ? encrypt(app_secret) : null
      encryptedPin =
        typeof pin === 'string' && pin.length > 0 ? encrypt(pin) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    // Resolve o canal-alvo (multi-canal):
    //   - channelId → edita aquele canal;
    //   - isNew → força novo canal (insert);
    //   - senão → edita o canal primário (retrocompatível com 1 canal).
    let existing: {
      id: string
      registered_at: string | null
      phone_number_id: string
      pin_encrypted: string | null
    } | null = null
    const existingCols = 'id, registered_at, phone_number_id, pin_encrypted'
    if (isNew) {
      existing = null
    } else {
      let lookup = supabase.from('whatsapp_config').select(existingCols)
      lookup = channelId
        ? lookup.eq('id', channelId).eq('account_id', accountId)
        : lookup.eq('account_id', accountId).eq('is_primary', true)
      const { data, error: lookupError } = await lookup.maybeSingle()
      if (lookupError) {
        // Falha aqui costumava passar silenciosa e o save seguia como se fosse
        // um canal novo — o insert então batia na UNIQUE(phone_number_id) e o
        // cliente via "Failed to save configuration" sem pista da causa.
        // A causa mais provável é a migration 083 não aplicada (coluna
        // pin_encrypted inexistente), então vale falhar dizendo isso.
        console.error(
          '[whatsapp/config POST] falha ao carregar o canal existente:',
          lookupError,
        )
        return NextResponse.json(
          {
            error:
              'Não foi possível ler a configuração atual do canal. Se o banco acabou de ser atualizado, confirme que a migration 083_whatsapp_config_activation.sql foi aplicada.',
          },
          { status: 500 },
        )
      }
      existing = data ?? null
    }

    // PIN efetivo: o que o cliente digitou agora, ou o que já está salvo.
    // Reusar o salvo é o que permite re-salvar o canal (girar token, mudar
    // rótulo) sem obrigar o cliente a lembrar do 2SV toda vez.
    let effectivePin: string | null =
      typeof pin === 'string' && pin.length > 0 ? pin : null
    if (!effectivePin && existing?.pin_encrypted) {
      try {
        effectivePin = decrypt(existing.pin_encrypted)
      } catch {
        // PIN salvo com outra ENCRYPTION_KEY. Segue sem ele: a ativação
        // devolve needs_pin e a UI pede de novo.
        effectivePin = null
      }
    }

    // Ativação: diagnostica o número na Meta e só então decide o que fazer.
    //
    // Substitui o antigo POST /register cego. O diagnóstico é o que permite
    // (a) aceitar um WABA ID no lugar do Phone Number ID, (b) não re-registrar
    // um número que já está CONNECTED, e (c) detectar EXPIRED antes de tentar
    // registrar — nesse caso o número só volta com código físico no chip.
    const activation = await activate({
      id: phone_number_id,
      accessToken: access_token,
      pin: effectivePin,
      preferPhoneNumber:
        typeof body.prefer_phone_number === 'string'
          ? body.prefer_phone_number
          : undefined,
    })

    // Resultados sem número resolvido: não há credencial útil para gravar.
    // Salvar aqui só criaria uma linha que nunca vai funcionar e que ainda
    // ocuparia o phone_number_id errado (o WABA ID) no índice único.
    if (
      activation.outcome === 'wrong_token_or_bm' ||
      activation.outcome === 'ambiguous_waba' ||
      (activation.outcome === 'meta_error' && activation.diagnosis === null)
    ) {
      console.error('[whatsapp/config POST] ativação abortada:', activation.outcome)
      return NextResponse.json(
        { error: activation.message, saved: false, ...activationPayload(activation) },
        { status: 400 },
      )
    }

    // Daqui pra baixo existe um Phone Number ID resolvido e um token que a
    // Meta aceitou. Mesmo que a ativação não tenha concluído (needs_pin,
    // needs_old_pin, needs_code_verification), o save prossegue: o CAMINHO B
    // precisa da linha salva para as chamadas de request_code/verify_code,
    // e o cliente não deve ter que redigitar tudo para tentar de novo.
    const diagnosis = activation.diagnosis!
    const resolvedPhoneId = diagnosis.phoneNumberId

    // Re-checa a posse com o ID resolvido (o cliente pode ter colado o WABA
    // ID, e a checagem anterior foi feita no que ele digitou).
    if (resolvedPhoneId !== phone_number_id) {
      const resolvedClaim = await isClaimedByAnotherAccount(resolvedPhoneId, accountId)
      if (resolvedClaim === 'error') {
        return NextResponse.json(
          { error: 'Failed to validate configuration' },
          { status: 500 },
        )
      }
      if (resolvedClaim === true) {
        return NextResponse.json(
          {
            error:
              'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
          },
          { status: 409 },
        )
      }
    }

    const live = isLive(activation)
    // registered_at = "está registrado na Meta AGORA", não "já esteve um dia".
    // Um número que perdeu a verificação (EXPIRED) precisa zerar o carimbo,
    // senão a UI continua mostrando o banner verde "Registrado" enquanto todo
    // envio falha. Nos demais casos não-conclusivos preservamos o valor
    // anterior, para um erro transitório da Meta não apagar histórico bom.
    const registeredAt = live
      ? new Date().toISOString()
      : activation.outcome === 'needs_code_verification'
        ? null
        : (existing?.registered_at ?? null)
    const registrationError =
      activation.outcome === 'meta_error' || activation.outcome === 'needs_old_pin'
        ? activation.message
        : null

    // WABA ID: preferimos o que o cliente informou, mas se ele colou o WABA ID
    // no campo do número, aproveitamos — é a mesma informação e evita um
    // segundo passo manual.
    const effectiveWabaId = waba_id || diagnosis.resolvedFromWabaId || null

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's
    // side, so we call on every save and persist the timestamp.
    // Skipped only when there's no waba_id (legacy rows from before
    // we required it).
    let subscribedAppsAt: string | null = null
    if (effectiveWabaId) {
      try {
        await subscribeWabaToApp({
          wabaId: effectiveWabaId,
          accessToken: access_token,
        })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('WABA subscribed_apps failed (non-fatal):', message)
        // Subscription failures are rare once the App has the right
        // permissions; we don't block save on them — the diagnostic
        // endpoint surfaces this state too.
      }
    }

    // Persist everything in one shot. If /register failed we still
    // store the credentials and the error so the UI can guide the
    // user through a retry.
    const baseRow = {
      // O ID RESOLVIDO, não o que o cliente digitou — se ele colou o WABA ID,
      // gravar aquilo aqui quebraria o roteamento do webhook (que casa por
      // phone_number_id) e ocuparia o índice único com o ID errado.
      phone_number_id: resolvedPhoneId,
      waba_id: effectiveWabaId,
      access_token: encryptedAccessToken,
      // `status` agora reflete o que a META diz, não o otimismo do save.
      // Antes, um save sem PIN gravava 'connected' sem nunca ter registrado —
      // a UI mostrava "Conectado" e os envios falhavam com 133010.
      status: live ? 'connected' : 'disconnected',
      connected_at: live ? new Date().toISOString() : null,
      registered_at: registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      code_verification_status: diagnosis.codeVerificationStatus || null,
      platform_type: diagnosis.platformType || null,
      last_diagnosis_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // PIN só é gravado quando veio um novo no corpo. Num re-save sem PIN,
      // preserva o que já estava salvo (mesma regra do verify_token abaixo).
      ...(encryptedPin ? { pin_encrypted: encryptedPin } : {}),
      // verify_token e app_secret: só gravam quando enviados. Num update com o
      // campo vazio, PRESERVAM o valor já salvo (não sobrescrevem com null) —
      // senão editar o canal só p/ girar o token zeraria o verify_token e
      // quebraria o recebimento (a Meta rejeita a verificação do webhook).
      ...(verify_token ? { verify_token: encryptedVerifyToken } : {}),
      ...(app_secret ? { app_secret: encryptedAppSecret } : {}),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(label ? { ...baseRow, label } : baseRow)
        .eq('id', existing.id)

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        )
      }
    } else {
      // Novo canal. É primário se for o PRIMEIRO da conta (senão, secundário).
      const { count: existingCount } = await supabase
        .from('whatsapp_config')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
      const isFirst = (existingCount ?? 0) === 0

      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          is_primary: isFirst,
          label: label ?? (isFirst ? 'Principal' : 'Novo canal'),
          ...baseRow,
        })

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        )
      }
    }

    // Sempre 200 daqui: a linha FOI salva. `success` diz se o número ficou no
    // ar; `activation.outcome` diz exatamente o que falta quando não ficou,
    // para a UI mostrar o próximo passo em vez de um toast genérico.
    return NextResponse.json({
      success: live,
      saved: true,
      // Informa quando o número guardado não é o que o cliente digitou, para a
      // UI poder dizer "identificamos o WABA ID e resolvemos o número X".
      resolved_phone_number_id:
        resolvedPhoneId !== phone_number_id ? resolvedPhoneId : null,
      resolved_from_waba_id: diagnosis.resolvedFromWabaId ?? null,
      ...activationPayload(activation),
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config[?channelId=...]
 *
 * Com `channelId`: remove aquele canal (multi-canal). Sem: remove TODOS os
 * canais da conta (reset, usado pra recuperar de token corrompido). Se o
 * removido era o primário e sobram canais, promove um a primário.
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const channelId = new URL(request.url).searchParams.get('channelId')

    let del = supabase.from('whatsapp_config').delete().eq('account_id', accountId)
    if (channelId) del = del.eq('id', channelId)
    const { error: deleteError } = await del

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    // Garante um primário se ainda houver canais.
    if (channelId) {
      const { data: rest } = await supabase
        .from('whatsapp_config')
        .select('id, is_primary')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
      if (rest && rest.length > 0 && !rest.some((r) => r.is_primary)) {
        await supabase
          .from('whatsapp_config')
          .update({ is_primary: true })
          .eq('id', rest[0].id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/config — define o canal primário da conta.
 * Body: { channelId, makePrimary: true }.
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }
    const body = await request.json().catch(() => ({}))
    const channelId = typeof body.channelId === 'string' ? body.channelId : null
    if (!channelId || body.makePrimary !== true) {
      return NextResponse.json(
        { error: 'Informe channelId e makePrimary: true.' },
        { status: 400 },
      )
    }
    // Confere que o canal é da conta.
    const { data: target } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('id', channelId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!target) {
      return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 })
    }
    // Desmarca todos, depois marca o alvo (o índice único parcial exige 1 só).
    await supabase
      .from('whatsapp_config')
      .update({ is_primary: false })
      .eq('account_id', accountId)
    const { error: setErr } = await supabase
      .from('whatsapp_config')
      .update({ is_primary: true })
      .eq('id', channelId)
    if (setErr) {
      return NextResponse.json({ error: 'Falha ao definir primário.' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
