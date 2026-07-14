// POST /api/billing/checkout — cria uma Stripe Checkout Session (assinatura).
//
// Dois cenários (onboarding Stripe-first):
//   A. Comprador SEM conta ainda (login puro, sem profile). A conta é criada no
//      PAGAMENTO: a session leva `user_id` no metadata e o webhook provisiona a
//      conta (provision_account). É assim que um cliente novo entra.
//   B. Conta existente fazendo upgrade — só o owner pode; a session leva
//      `account_id` e o webhook só troca o plano.
// Retorna { url } para redirecionar ao Stripe Checkout.

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getCurrentAccount,
  toErrorResponse,
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/auth/account";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getStripe } from "@/lib/billing/stripe";
import { getPlan } from "@/lib/billing/plans";

const bodySchema = z.object({
  plan: z.enum(["starter", "pro", "enterprise"]),
  ciclo: z.enum(["mensal", "anual"]).default("mensal"),
});

export async function POST(request: Request) {
  try {
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

    // Resolve o contexto: tem conta (upgrade) ou é login puro (primeira compra)?
    let accountId: string | null = null;
    let accountName: string | null = null;
    let userId: string;
    let userEmail: string | null = null;

    try {
      const ctx = await getCurrentAccount();
      // Cenário B: já tem conta → exige owner para comprar/upgrade.
      if (ctx.role !== "owner") {
        throw new ForbiddenError(
          "Apenas o dono da conta pode gerenciar a assinatura.",
        );
      }
      accountId = ctx.accountId;
      accountName = ctx.account.name;
      userId = ctx.userId;
    } catch (err) {
      if (err instanceof ForbiddenError && err.message.startsWith("Apenas")) {
        throw err; // owner check acima — repassa 403
      }
      if (err instanceof UnauthorizedError) {
        throw err; // sem sessão → 401
      }
      // ForbiddenError "not linked to an account" → Cenário A: login sem conta.
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new UnauthorizedError();
      userId = user.id;
      userEmail = user.email ?? null;
    }

    const admin = supabaseAdmin();
    const stripe = getStripe();

    // Reaproveita ou cria o customer Stripe.
    let customerId: string | null = null;
    if (accountId) {
      const { data: acct } = await admin
        .from("accounts")
        .select("stripe_customer_id")
        .eq("id", accountId)
        .maybeSingle<{ stripe_customer_id: string | null }>();
      customerId = acct?.stripe_customer_id ?? null;
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: accountName ?? undefined,
        email: userEmail ?? undefined,
        metadata: accountId ? { account_id: accountId } : { user_id: userId },
      });
      customerId = customer.id;
      if (accountId) {
        await admin
          .from("accounts")
          .update({ stripe_customer_id: customerId })
          .eq("id", accountId);
      }
    }

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

    // Cenário A (primeira compra): sucesso volta pra /comecar, que espera a
    // conta ser provisionada pelo webhook e então entra no /dashboard.
    // Cenário B (upgrade): volta pra tela de billing.
    const successUrl = accountId
      ? `${origin}/settings?tab=billing&status=success`
      : `${origin}/comecar?status=success`;
    const cancelUrl = accountId
      ? `${origin}/settings?tab=billing&status=cancel`
      : `${origin}/comecar?status=cancel`;

    // O webhook casa a assinatura pela conta (upgrade) OU provisiona a conta a
    // partir do user_id (primeira compra).
    const meta: Record<string, string> = accountId
      ? { account_id: accountId, plan: plan.id }
      : { user_id: userId, plan: plan.id };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: meta,
      subscription_data: { metadata: meta },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
