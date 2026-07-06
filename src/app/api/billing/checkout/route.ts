// POST /api/billing/checkout — cria uma Stripe Checkout Session (assinatura).
// Só o owner da conta pode iniciar a compra. Retorna { url } para redirecionar.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getStripe } from "@/lib/billing/stripe";
import { getPlan } from "@/lib/billing/plans";

const bodySchema = z.object({
  plan: z.enum(["starter", "pro", "enterprise"]),
  ciclo: z.enum(["mensal", "anual"]).default("mensal"),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("owner");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "Plano inválido." }, { status: 400 });
    }

    const plan = getPlan(body.plan);
    const envName =
      body.ciclo === "anual" ? plan.stripePriceEnvAnual : plan.stripePriceEnvMensal;
    if (!envName) {
      return NextResponse.json(
        { error: "Plano/ciclo não comprável." },
        { status: 400 },
      );
    }
    const priceId = process.env[envName];
    if (!priceId) {
      return NextResponse.json(
        { error: `Price do Stripe não configurado (${envName}).` },
        { status: 500 },
      );
    }

    const admin = supabaseAdmin();
    const stripe = getStripe();

    // Reaproveita ou cria o customer Stripe da conta.
    const { data: acct } = await admin
      .from("accounts")
      .select("stripe_customer_id, name")
      .eq("id", ctx.accountId)
      .maybeSingle<{ stripe_customer_id: string | null; name: string }>();

    let customerId = acct?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: acct?.name ?? undefined,
        metadata: { account_id: ctx.accountId },
      });
      customerId = customer.id;
      await admin
        .from("accounts")
        .update({ stripe_customer_id: customerId })
        .eq("id", ctx.accountId);
    }

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/settings?tab=billing&status=success`,
      cancel_url: `${origin}/settings?tab=billing&status=cancel`,
      // O webhook usa estes metadados para casar a assinatura com a conta.
      metadata: { account_id: ctx.accountId, plan: plan.id },
      subscription_data: {
        metadata: { account_id: ctx.accountId, plan: plan.id },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
