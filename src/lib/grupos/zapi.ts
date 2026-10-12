// Cliente mínimo da Z-API para o número do agente de grupo.
// Env (Vercel): ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN (token de
// segurança da conta, vai no header Client-Token).

const BASE = 'https://api.z-api.io/instances';

export function zapiConfigured(): boolean {
  return !!(
    process.env.ZAPI_INSTANCE_ID &&
    process.env.ZAPI_TOKEN &&
    process.env.ZAPI_CLIENT_TOKEN
  );
}

/** Envia texto para um grupo (phone = id do grupo como chega no webhook). */
export async function sendGroupText(
  groupPhone: string,
  message: string,
  replyToMessageId?: string
): Promise<boolean> {
  if (!zapiConfigured()) {
    console.error('[grupos] Z-API não configurada');
    return false;
  }
  const url = `${BASE}/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': process.env.ZAPI_CLIENT_TOKEN!,
      },
      body: JSON.stringify({
        phone: groupPhone,
        message: message.slice(0, 4000),
        ...(replyToMessageId ? { messageId: replyToMessageId } : {}),
      }),
    });
    if (!res.ok)
      console.error(
        '[grupos] send-text',
        res.status,
        await res.text().catch(() => '')
      );
    return res.ok;
  } catch (e) {
    console.error('[grupos] send-text falhou', e);
    return false;
  }
}

/** Formato do callback "Ao receber" da Z-API (só o que usamos). */
export interface ZapiInbound {
  instanceId?: string;
  messageId?: string;
  phone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  isNewsletter?: boolean;
  chatName?: string;
  senderName?: string;
  participantPhone?: string;
  participantLid?: string;
  connectedPhone?: string;
  type?: string;
  text?: { message?: string };
}
