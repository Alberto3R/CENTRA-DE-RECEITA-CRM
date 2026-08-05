import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/errors";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";
import { activate, isLive } from "@/lib/whatsapp/activation";
import { subscribeWabaToApp } from "@/lib/whatsapp/meta-api";

/**
 * POST /api/admin/tenants/{accountId}/activate-whatsapp
 *
 * Diagnostica e ativa o número de WhatsApp de um tenant, em nome dele.
 *
 * Por que uma ação dirigida, e não impersonation com escrita:
 *
 *   A impersonation é somente-leitura por desenho, e o caso de suporte
 *   mais comum — "o cliente registrou o número mas ele não conectou" —
 *   exige escrever. A saída fácil seria abrir um modo de escrita geral,
 *   que devolveria ao platform admin o poder de mexer em tudo do
 *   cliente e traria de volta todo o risco que a leitura-só eliminou.
 *
 *   Esta rota faz UMA coisa. Não edita contato, não manda mensagem, não
 *   altera pipeline. O raio de alcance é o canal, e cada uso fica no log.
 *
 * Boa parte dos casos nem precisa de PIN: quando a Meta já reporta o
 * número como CONNECTED, o que está errado é só o estado local, e o
 * diagnóstico reconcilia sem tocar em nada na Meta — exatamente o
 * sintoma "registrou mas não ficou conectado".
 *
 * Body: { channelId?: string, pin?: string, reason: string }
 */

const MIN_REASON_LENGTH = 10;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { userId } = await requirePlatformAdmin();
    const { accountId } = await params;

    const body = (await request.json().catch(() => null)) as {
      channelId?: string;
      pin?: string;
      reason?: string;
    } | null;

    const reason = body?.reason?.trim() ?? "";
    const pin = body?.pin?.trim() ?? "";

    if (reason.length < MIN_REASON_LENGTH) {
      return NextResponse.json(
        {
          error: `Descreva o motivo com pelo menos ${MIN_REASON_LENGTH} caracteres — ele fica no log.`,
        },
        { status: 400 },
      );
    }
    if (pin && !/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: "O PIN deve ter exatamente 6 dígitos." },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();

    let query = admin
      .from("whatsapp_config")
      .select("id, phone_number_id, waba_id, access_token, pin_encrypted, registered_at")
      .eq("account_id", accountId)
      .eq("channel_type", "whatsapp");
    query = body?.channelId
      ? query.eq("id", body.channelId)
      : query.eq("is_primary", true);

    const { data: config, error: cfgErr } = await query.maybeSingle();
    if (cfgErr) {
      console.error("[admin/activate] falha ao carregar canal:", cfgErr);
      return NextResponse.json(
        { error: "Não foi possível carregar o canal." },
        { status: 500 },
      );
    }
    if (!config) {
      return NextResponse.json(
        { error: "Este tenant não tem canal de WhatsApp configurado." },
        { status: 404 },
      );
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch {
      return NextResponse.json(
        {
          error:
            "O token salvo deste cliente não pôde ser descriptografado (ENCRYPTION_KEY mudou). Ele precisa re-salvar as credenciais.",
        },
        { status: 400 },
      );
    }

    // PIN: o informado agora, senão o que o cliente já salvou.
    let effectivePin: string | null = pin || null;
    if (!effectivePin && config.pin_encrypted) {
      try {
        effectivePin = decrypt(config.pin_encrypted);
      } catch {
        effectivePin = null;
      }
    }

    console.warn(
      `[admin/activate] INÍCIO actor=${userId} tenant=${accountId} canal=${config.id} motivo="${reason}"`,
    );

    const result = await activate({
      id: config.phone_number_id,
      accessToken,
      pin: effectivePin,
    });

    // Sem número resolvido não há o que gravar — o token ou o ID do
    // cliente é que estão errados, e isso ele precisa corrigir.
    if (
      result.outcome === "wrong_token_or_bm" ||
      result.outcome === "ambiguous_waba" ||
      (result.outcome === "meta_error" && result.diagnosis === null)
    ) {
      return NextResponse.json(
        { error: result.message, activation: result, saved: false },
        { status: 400 },
      );
    }

    const diagnosis = result.diagnosis!;
    const live = isLive(result);
    const agora = new Date().toISOString();

    // subscribed_apps é idempotente na Meta; aproveita a passagem para
    // consertar o outro motivo clássico de "não chega evento".
    let subscribedAppsAt: string | null = null;
    const wabaId = config.waba_id || diagnosis.resolvedFromWabaId || null;
    if (wabaId) {
      try {
        await subscribeWabaToApp({ wabaId, accessToken });
        subscribedAppsAt = agora;
      } catch (err) {
        console.warn(
          "[admin/activate] subscribed_apps falhou (não fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const registrationError =
      result.outcome === "meta_error" || result.outcome === "needs_old_pin"
        ? result.message
        : null;

    const { error: upErr } = await admin
      .from("whatsapp_config")
      .update({
        phone_number_id: diagnosis.phoneNumberId,
        waba_id: wabaId,
        status: live ? "connected" : "disconnected",
        connected_at: live ? agora : null,
        registered_at: live
          ? agora
          : result.outcome === "needs_code_verification"
            ? null
            : (config.registered_at ?? null),
        ...(subscribedAppsAt ? { subscribed_apps_at: subscribedAppsAt } : {}),
        last_registration_error: registrationError,
        code_verification_status: diagnosis.codeVerificationStatus || null,
        platform_type: diagnosis.platformType || null,
        last_diagnosis_at: agora,
        updated_at: agora,
        // Guarda o PIN só quando veio um novo — assim o cliente não
        // precisa informar de novo na próxima reconexão.
        ...(pin ? { pin_encrypted: encrypt(pin) } : {}),
      })
      .eq("id", config.id);

    if (upErr) {
      console.error("[admin/activate] falha ao persistir:", upErr);
      return NextResponse.json(
        {
          error:
            "A Meta respondeu, mas houve falha ao salvar o estado local. Tente de novo.",
        },
        { status: 500 },
      );
    }

    console.warn(
      `[admin/activate] FIM actor=${userId} tenant=${accountId} canal=${config.id} resultado=${result.outcome}`,
    );

    return NextResponse.json({
      success: live,
      saved: true,
      activation: result,
      phone_info: diagnosis.info,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
