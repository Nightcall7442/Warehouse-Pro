import Stripe from "stripe";
import { env } from "./env";
import { PLANS as BASE_PLANS, type PlanKey } from "../../contracts/constants";

// Lazy singleton — only instantiated if STRIPE_SECRET_KEY is set
let _stripe: Stripe | null = null;

const keyUsable = () => !!env.stripeSecretKey && !env.stripeSecretKey.startsWith("dev-insecure");

/**
 * Можно ли вообще платить картой через Stripe: ключ настоящий и заведена хоть
 * одна цена.
 *
 * Без этого /settings/billing показывал «Подключить», которое отвечало
 * «STRIPE_SECRET_KEY is not configured» или «Plan not configured», — а туда
 * вели полоса о конце пробного, письмо и экран блокировки. Основной путь
 * оплаты — заявка в сумах на /billing; Stripe (доллары) — наследство и
 * показывается, только если его правда настроили.
 */
export function stripeConfigured(): boolean {
  return keyUsable() && !!(env.stripeStandardPriceId || env.stripeBasicPriceId || env.stripeProPriceId || env.stripeExclusivePriceId);
}

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!keyUsable()) {
      throw new Error("STRIPE_SECRET_KEY is not configured.");
    }
    _stripe = new Stripe(env.stripeSecretKey, { apiVersion: "2024-06-20" });
  }
  return _stripe;
}

/*
  Stripe-цены (центы USD). «Стандарт» — цена ЗА МЕСТО: сумму считает сам
  Stripe по количеству (полевые, не меньше MIN_FIELD_USERS), поэтому здесь
  числа нет — оно живёт в STRIPE_STANDARD_PRICE_ID. Прежние тарифы — для
  продления тем, кто уже на них (до GRANDFATHER_UNTIL).
*/
export const PLANS: Record<PlanKey, (typeof BASE_PLANS)[PlanKey] & { price: number; priceId: string | null; perSeat?: true }> = {
  trial:     { ...BASE_PLANS.trial,     price: 0,           priceId: null },
  standard:  { ...BASE_PLANS.standard,  price: 0,           priceId: env.stripeStandardPriceId || null, perSeat: true },
  basic:     { ...BASE_PLANS.basic,     price: 99_00,      priceId: env.stripeBasicPriceId || null },
  pro:       { ...BASE_PLANS.pro,       price: 249_00,     priceId: env.stripeProPriceId || null },
  exclusive: { ...BASE_PLANS.exclusive, price: 999_00,     priceId: env.stripeExclusivePriceId || null },
};

export async function verifyWebhook(body: string, signature: string): Promise<Stripe.Event> {
  const stripe = getStripe();
  return stripe.webhooks.constructEventAsync(body, signature, env.stripeWebhookSecret);
}
