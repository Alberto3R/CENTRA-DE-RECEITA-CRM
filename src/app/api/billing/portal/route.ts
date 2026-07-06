// POST /api/billing/portal — cria uma sessão do Stripe Billing Portal.
// Só o owner da conta. Retorna { url } para o cliente gerenciar a assinatura
// (ver/baixar faturas, trocar cartão, mudar de plano, cancelar) sem sair pro
// dashboard do Stripe. Espelha os padrões de /api/billing/checkout.

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getStripe } from "@/lib/billing/stripe";

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("owner");

    const admin = supabaseAdmin();
    const { data: acct } = await admin
      .from("accounts")
      .select("stripe_customer_id")
      .eq("id", ctx.accountId)
      .maybeSingle<{ stripe_customer_id: string | null }>();

    if (!acct?.stripe_customer_id) {
      return NextResponse.json(
        { error: "Nenhuma assinatura para gerenciar. Assine um plano primeiro." },
        { status: 400 },
      );
    }

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: acct.stripe_customer_id,
      return_url: `${origin}/settings?tab=billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
