import Stripe from "stripe";
import { env } from "./env";
import { PLANS as BASE_PLANS, type PlanKey } from "../../contracts/constants";

// Lazy singleton — only instantiated if STRIPE_SECRET_KEY is set
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!env.stripeSecretKey || env.stripeSecretKey.startsWith("dev-insecure")) {
      throw new Error("STRIPE_SECRET_KEY is not configured.");
    }
    _stripe = new Stripe(env.stripeSecretKey, { apiVersion: "2024-06-20" });
  }
  return _stripe;
}

// Extend shared plan metadata with Stripe-specific pricing (USD cents).
export const PLANS: Record<PlanKey, (typeof BASE_PLANS)[PlanKey] & { price: number; priceId: string | null }> = {
  basic:     { ...BASE_PLANS.basic,     price: 99_00,      priceId: env.stripeBasicPriceId || null },
  pro:       { ...BASE_PLANS.pro,       price: 249_00,     priceId: env.stripeProPriceId || null },
  exclusive: { ...BASE_PLANS.exclusive, price: 999_00,     priceId: env.stripeExclusivePriceId || null },
};

export async function verifyWebhook(body: string, signature: string): Promise<Stripe.Event> {
  const stripe = getStripe();
  return stripe.webhooks.constructEventAsync(body, signature, env.stripeWebhookSecret);
}
