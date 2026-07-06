// E-mail transacional (Resend). Scaffolding da camada SaaS — usado para convites,
// boas-vindas pós-signup, avisos de quota (80%/100%) e eventos de billing.
//
// Lazy: só exige RESEND_API_KEY no primeiro envio real. Se a key não estiver
// configurada, `enviarEmail` vira no-op logado (não derruba o fluxo principal).

import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

const REMETENTE_PADRAO =
  process.env.EMAIL_FROM ?? "Central de Receita <no-reply@sales3r.com.br>";

export interface EmailParams {
  para: string;
  assunto: string;
  html: string;
}

/**
 * Envia um e-mail transacional. No-op (logado) quando RESEND_API_KEY não está
 * configurada — telemetria/notificação nunca derruba a operação principal.
 */
export async function enviarEmail(p: EmailParams): Promise<{ ok: boolean }> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY ausente — e-mail "${p.assunto}" não enviado.`);
    return { ok: false };
  }
  try {
    await resend.emails.send({
      from: REMETENTE_PADRAO,
      to: p.para,
      subject: p.assunto,
      html: p.html,
    });
    return { ok: true };
  } catch (err) {
    console.error(`[email] falha ao enviar "${p.assunto}":`, err);
    return { ok: false };
  }
}

/** Aviso de quota (80% ou 100%) do mês para uma conta. */
export async function avisarQuota(
  para: string,
  unidade: "análises" | "gerações de IA",
  pct: 80 | 100,
): Promise<void> {
  const titulo =
    pct === 100
      ? `Seu limite de ${unidade} do mês acabou`
      : `Você já usou 80% das suas ${unidade} do mês`;
  await enviarEmail({
    para,
    assunto: titulo,
    html: `<p>${titulo}.</p><p>Faça upgrade do plano para continuar usando a IA de gestão comercial sem interrupção.</p>`,
  });
}
