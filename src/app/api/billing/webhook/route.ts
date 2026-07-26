// POST /api/billing/webhook — recebe eventos do Stripe e sincroniza o plano da
// conta. Escrita via service role (não há sessão de usuário). Verifica a
// assinatura HMAC com STRIPE_WEBHOOK_SECRET — padrão idêntico ao webhook do
// WhatsApp já existente no repo.

import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getStripe } from "@/lib/billing/stripe";
import { isPlanId } from "@/lib/billing/plans";
import { enviarEmail } from "@/lib/email/client";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://sales-3r-crm.vercel.app";

/**
 * Compra vinda do funil público (Payment Link) chega SEM user_id/account_id no
 * metadata — só o e-mail do comprador. Aqui a gente resolve a conta a partir
 * do e-mail: acha o usuário (ou cria), provisiona a conta e manda o acesso.
 * É o que faltava — sem isso, toda venda pelo site paga e fica sem acesso.
 */
async function provisionarPorEmail(email: string): Promise<string | null> {
  const admin = supabaseAdmin();
  try {
    let userId: string | null = null;
    const { data: found } = await admin.rpc("get_user_id_by_email", {
      p_email: email,
    });
    userId = (found as string | null) ?? null;

    let isNew = false;
    if (!userId) {
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({ email, email_confirm: true });
      if (createErr || !created?.user) {
        console.error("[stripe webhook] createUser falhou:", createErr);
        return null;
      }
      userId = created.user.id;
      isNew = true;
    }

    const { data: accId, error: provErr } = await admin.rpc(
      "provision_account",
      { p_user_id: userId },
    );
    if (provErr) {
      console.error("[stripe webhook] provision_account (email) falhou:", provErr);
      return null;
    }
    const accountId = (accId as string | null) ?? null;

    // Entrega o acesso: link pra definir senha (novo) ou entrar (existente).
    try {
      const { data: link } = await admin.auth.admin.generateLink({
        type: isNew ? "invite" : "recovery",
        email,
      });
      const actionLink =
        (link as { properties?: { action_link?: string } } | null)?.properties
          ?.action_link ?? APP_URL;
      await enviarEmail({
        para: email,
        assunto: "Seu acesso à Central de Receita 🎉",
        html: `<div style="font-family:Arial;font-size:15px;color:#1a1a1a">
          <h2>Sua assinatura está ativa!</h2>
          <p>Bem-vindo(a) à Central de Receita. Clique abaixo para ${isNew ? "definir sua senha e" : ""} acessar:</p>
          <p><a href="${actionLink}" style="display:inline-block;background:#111;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">${isNew ? "Definir senha e entrar" : "Acessar a Central de Receita"}</a></p>
          <p style="color:#555">Ou acesse <a href="${APP_URL}">${APP_URL}</a> com o e-mail <b>${email}</b>.</p>
        </div>`,
      });
    } catch (e) {
      console.error("[stripe webhook] envio do acesso falhou:", e);
    }

    return accountId;
  } catch (e) {
    console.error("[stripe webhook] provisionarPorEmail erro:", e);
    return null;
  }
}

/** Mapeia o status do Stripe para o plano efetivo da conta. */
function planoEfetivo(status: string, plan: string): string {
  if (status === "active" || status === "trialing") {
    return isPlanId(plan) ? plan : "pro";
  }
  // past_due/canceled/incomplete → cai para free (gating fecha o premium).
  return "free";
}

/**
 * Descobre a conta desta assinatura. Na PRIMEIRA compra a session carrega só
 * `user_id` (o comprador ainda não tinha conta) — aí provisionamos a conta
 * (provision_account: cria conta + profile owner) e devolvemos o id. Em upgrade
 * a assinatura já traz `account_id`.
 */
async function resolveAccountId(
  meta: Stripe.Metadata | null | undefined,
): Promise<string | null> {
  if (meta?.account_id) return meta.account_id;
  if (meta?.user_id) {
    const admin = supabaseAdmin();
    const { data, error } = await admin.rpc("provision_account", {
      p_user_id: meta.user_id,
    });
    if (error) {
      console.error("[stripe webhook] provision_account falhou:", error);
      return null;
    }
    return (data as string | null) ?? null;
  }
  return null;
}

async function aplicarAssinatura(
  sub: Stripe.Subscription,
  accountIdOverride?: string | null,
): Promise<void> {
  const admin = supabaseAdmin();
  const accountId = accountIdOverride ?? (await resolveAccountId(sub.metadata));
  if (!accountId) {
    console.error("[stripe webhook] subscription sem account_id/user_id no metadata");
    return;
  }
  // Plano: metadata da subscription tem prioridade; senão lê do preço (os
  // Payment Links carregam plan=starter|pro na metadata do price).
  const priceMeta = sub.items?.data?.[0]?.price?.metadata as
    | { plan?: string }
    | undefined;
  const plan = sub.metadata?.plan ?? priceMeta?.plan ?? "pro";
  const status = sub.status;
  // `current_period_end` mudou de lugar entre versões da API do Stripe (topo da
  // subscription vs. no item). Lemos de ambos com cast defensivo.
  const item0 = sub.items?.data?.[0] as unknown as
    | { current_period_end?: number }
    | undefined;
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    item0?.current_period_end ??
    null;
  const periodEndIso = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  await admin.from("subscriptions").upsert(
    {
      account_id: accountId,
      stripe_customer_id:
        typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
      stripe_subscription_id: sub.id,
      plan: isPlanId(plan) ? plan : "pro",
      status,
      current_period_end: periodEndIso,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );

  await admin
    .from("accounts")
    .update({
      plan: planoEfetivo(status, plan),
      subscription_status: status,
      stripe_subscription_id: sub.id,
    })
    .eq("id", accountId);
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET não configurado");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("[stripe webhook] assinatura inválida:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await getStripe().subscriptions.retrieve(subId);
          // O metadata da SESSION é a fonte da verdade (account_id em upgrade OU
          // user_id na primeira compra). Resolve a conta — provisionando se for
          // a primeira compra.
          let accountId = await resolveAccountId(
            session.metadata ?? sub.metadata,
          );
          // Funil público (Payment Link): sem user_id/account_id no metadata,
          // provisiona a partir do e-mail do comprador.
          if (!accountId) {
            const cust = sub.customer;
            const custEmail =
              cust && typeof cust !== "string" && !("deleted" in cust)
                ? cust.email
                : null;
            const email = session.customer_details?.email ?? custEmail ?? null;
            if (email) accountId = await provisionarPorEmail(email);
          }
          // Carimba o account_id resolvido na assinatura no Stripe, para que os
          // eventos futuros (updated/deleted) já venham com ele.
          if (accountId && sub.metadata?.account_id !== accountId) {
            try {
              await getStripe().subscriptions.update(subId, {
                metadata: {
                  ...sub.metadata,
                  account_id: accountId,
                  plan: session.metadata?.plan ?? sub.metadata?.plan ?? "pro",
                },
              });
              sub.metadata = { ...sub.metadata, account_id: accountId };
            } catch (e) {
              console.error("[stripe webhook] falha ao carimbar account_id:", e);
            }
          }
          await aplicarAssinatura(sub, accountId);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await aplicarAssinatura(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        // Ignora os demais eventos silenciosamente.
        break;
    }
  } catch (err) {
    console.error(`[stripe webhook] falha ao processar ${event.type}:`, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
