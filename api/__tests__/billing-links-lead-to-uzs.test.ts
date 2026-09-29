import { describe, it, expect, vi, beforeEach } from "vitest";
import { PLAN_PRICES_UZS } from "../../contracts/constants";

/**
 * Письмо о конце пробного и «настроен ли Stripe» — сервер.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Письмо о конце пробного вело на /settings/billing — экран Stripe, где
 * «Подключить» отвечало «STRIPE_SECRET_KEY is not configured» или вело к
 * оплате в долларах. И в самом письме стояло «Basic $99/мес · Pro $249/мес» —
 * цены, по которым в Узбекистане не платят и которые разошлись с экраном.
 * Спросить у сервера «есть ли вообще Stripe» экрану было нечем.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · письмо ведёт по переданной ссылке (крон передаёт /billing — это
 *     проверяет real-db/subscription-renewal.test.ts), цены в нём — суммы из
 *     PLAN_PRICES_UZS, долларов нет, имя организации экранировано;
 *   · stripeConfigured честен: нужен настоящий ключ И хоть одна цена.
 *
 * Нарочная поломка: вернуть строку «$99/мес» — падает первый; убрать из
 * stripeConfigured проверку цен — второй.
 */
const sent = vi.hoisted(() => [] as Array<{ subject: string; html: string }>);
const env = vi.hoisted(() => ({
  stripeSecretKey: "", stripeBasicPriceId: "", stripeProPriceId: "", stripeExclusivePriceId: "",
  smtpHost: "", smtpFrom: "t@t", appUrl: "https://wp.test",
}));
vi.mock("../lib/env", () => ({ env }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: async (m: { subject: string; html: string }) => { sent.push(m); return {}; } }),
    getTestMessageUrl: () => "",
  },
}));

beforeEach(() => {
  sent.length = 0;
  Object.assign(env, { stripeSecretKey: "", stripeBasicPriceId: "", stripeProPriceId: "", stripeExclusivePriceId: "" });
});

describe("письмо о конце пробного", () => {
  it("ведёт куда сказано, цены — в сумах из общего источника", async () => {
    const { sendTrialEndingEmail } = await import("../lib/mailer");
    await sendTrialEndingEmail("ceo@org.uz", "ООО <Рога>", 2, "https://wp.test/billing");

    expect(sent).toHaveLength(1);
    const html = sent[0].html;
    expect(html).toContain('href="https://wp.test/billing"');
    expect(html).not.toContain("$");
    for (const p of Object.values(PLAN_PRICES_UZS).filter(v => v > 0)) {
      expect(html, `нет цены ${p}`).toContain(p.toLocaleString("ru-RU"));
    }
    expect(html).toContain("сум/мес");
    expect(html).toContain("ООО &lt;Рога&gt;");
  });
});

describe("stripeConfigured", () => {
  it("нужен настоящий ключ и хоть одна цена", async () => {
    const { stripeConfigured } = await import("../lib/stripe");
    expect(stripeConfigured(), "ничего не задано").toBe(false);

    env.stripeSecretKey = "sk_live_abc";
    expect(stripeConfigured(), "ключ без цен — «Plan not configured» на каждой кнопке").toBe(false);

    env.stripeProPriceId = "price_pro";
    expect(stripeConfigured()).toBe(true);

    env.stripeSecretKey = "dev-insecure-placeholder";
    expect(stripeConfigured(), "заглушка разработчика — не ключ").toBe(false);
  });
});
