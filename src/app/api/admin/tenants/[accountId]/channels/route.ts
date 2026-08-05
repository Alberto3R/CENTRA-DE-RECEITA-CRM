import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/errors";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * GET /api/admin/tenants/{accountId}/channels
 *
 * Canais de WhatsApp de um tenant, para o painel diagnosticar sem
 * precisar entrar na conta.
 *
 * Devolve apenas metadados de estado. Nenhum segredo sai daqui: o
 * access_token, o verify_token, o app_secret e o pin_encrypted ficam de
 * fora da projeção de propósito — o painel nunca precisa vê-los, e o que
 * não trafega não vaza.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    await requirePlatformAdmin();
    const { accountId } = await params;

    const { data, error } = await supabaseAdmin()
      .from("whatsapp_config")
      .select(
        "id, label, is_primary, channel_type, phone_number_id, waba_id, status, registered_at, subscribed_apps_at, last_registration_error, code_verification_status, platform_type, last_diagnosis_at, pin_encrypted, updated_at",
      )
      .eq("account_id", accountId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[admin/channels] falha ao listar:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os canais." },
        { status: 500 },
      );
    }

    const channels = (data ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      isPrimary: c.is_primary,
      channelType: c.channel_type,
      phoneNumberId: c.phone_number_id,
      wabaId: c.waba_id,
      status: c.status,
      registeredAt: c.registered_at,
      subscribedAppsAt: c.subscribed_apps_at,
      lastRegistrationError: c.last_registration_error,
      codeVerificationStatus: c.code_verification_status,
      platformType: c.platform_type,
      lastDiagnosisAt: c.last_diagnosis_at,
      // Só o fato de existir — nunca o valor. Diz ao operador se ele
      // precisa pedir o PIN ao cliente ou se já temos um guardado.
      hasSavedPin: c.pin_encrypted != null,
      updatedAt: c.updated_at,
    }));

    return NextResponse.json({ channels });
  } catch (err) {
    return toErrorResponse(err);
  }
}
