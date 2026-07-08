import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";

/**
 * POST /api/checkout/lead  (público — funil de venda da Central de Receita)
 *
 * Recebe os dados da empresa do formulário da página de vendas, grava o lead
 * em checkout_leads e devolve a URL do checkout do Stripe (Payment Link) do
 * plano/ciclo escolhido, já com o e-mail pré-preenchido.
 */
const LINKS: Record<string, string> = {
  starter_mensal: "https://buy.stripe.com/3cI9AT7o9bMx1689Eq1sQ05",
  starter_anual: "https://buy.stripe.com/4gM7sLeQBeYJ024eYK1sQ06",
  pro_mensal: "https://buy.stripe.com/4gM3cv5g19EpdSU9Eq1sQ07",
  pro_anual: "https://buy.stripe.com/bJecN59wh03P6qs03Q1sQ08",
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    empresa?: string;
    nome?: string;
    email?: string;
    whatsapp?: string;
    plano?: string;
    ciclo?: string;
  } | null;

  const email = body?.email?.trim();
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }

  const plano = body?.plano === "pro" ? "pro" : "starter";
  const ciclo = body?.ciclo === "anual" ? "anual" : "mensal";
  const link = LINKS[`${plano}_${ciclo}`];
  if (!link) {
    return NextResponse.json({ error: "Plano inválido" }, { status: 400 });
  }

  // Grava o lead (best-effort — não bloqueia o checkout se falhar).
  try {
    await supabaseAdmin().from("checkout_leads").insert({
      empresa: body?.empresa?.trim() || null,
      nome: body?.nome?.trim() || null,
      email,
      whatsapp: body?.whatsapp?.trim() || null,
      plano,
      ciclo,
      origem: "landing_central_receita",
    });
  } catch (e) {
    console.error("[checkout/lead] insert falhou:", e);
  }

  const url = `${link}?prefilled_email=${encodeURIComponent(email)}`;
  return NextResponse.json({ url });
}
