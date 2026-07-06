// Client Stripe (lazy). Lê STRIPE_SECRET_KEY do ambiente.
// Usado pelas rotas /api/billing/checkout e /api/billing/webhook.

import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY não definida no ambiente.");
    }
    _stripe = new Stripe(key);
  }
  return _stripe;
}
