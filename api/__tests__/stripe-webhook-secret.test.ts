import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

/**
 * Вебхук Stripe без секрета не принимает ничего.
 *
 * Аудит 19.10.2026: подпись Stripe — HMAC тела секретом вебхука, а
 * библиотека Stripe пустой секрет не отвергает. Был задан STRIPE_SECRET_KEY,
 * а STRIPE_WEBHOOK_SECRET пуст — и событие, подписанное пустым ключом
 * (посчитать его может кто угодно), проходило проверку: «оплатить» себе
 * тариф или отключить чужую организацию.
 *
 * Проверяется настоящей библиотекой Stripe, без подделки проверки подписи.
 *
 * Нарочная поломка: убери проверку секрета в verifyWebhook — упадёт первая.
 */

const env = vi.hoisted(() => ({ stripeSecretKey: "sk_test_audit", stripeWebhookSecret: "" as string }));
vi.mock("../lib/env", () => ({ env }));

const payload = JSON.stringify({
  id: "evt_forged", object: "event", type: "checkout.session.completed",
  data: { object: { metadata: { tenantId: "1", plan: "exclusive" } } },
});
const signed = (secret: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
};

describe("вебхук Stripe: секрет обязателен", () => {
  beforeEach(() => { env.stripeWebhookSecret = ""; });

  it("секрет пуст — событие, подписанное пустым ключом, отвергается", async () => {
    const { verifyWebhook } = await import("../lib/stripe");
    await expect(verifyWebhook(payload, signed(""))).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("секрет из пробелов — тоже закрыто", async () => {
    env.stripeWebhookSecret = "   ";
    const { verifyWebhook } = await import("../lib/stripe");
    await expect(verifyWebhook(payload, signed("   "))).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("секрет задан — подписанное им событие проходит, подделка — нет", async () => {
    env.stripeWebhookSecret = "whsec_audit";
    const { verifyWebhook } = await import("../lib/stripe");
    await expect(verifyWebhook(payload, signed("whsec_audit"))).resolves.toMatchObject({ id: "evt_forged" });
    await expect(verifyWebhook(payload, signed(""))).rejects.toThrow();
  });
});
