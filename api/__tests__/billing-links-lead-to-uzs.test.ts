import { describe, it, expect, vi, beforeEach } from "vitest";
import { FIELD_PRICE_UZS, LEGACY_PRICES_UZS, formatSum, monthlyPrice } from "../../contracts/pricing";

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
 *     проверяет real-db/subscription-renewal.test.ts), цена в нём — за
 *     полевого сотрудника и сумма для этой организации (contracts/pricing.ts),
 *     прежних тарифов и долларов нет, имя организации экранировано;
 *   · stripeConfigured честен: нужен настоящий ключ И хоть одна цена.
 *
 * Нарочная поломка: вернуть строку «$99/мес» — падает первый; убрать из
 * stripeConfigured проверку цен — второй.
 */
const sent = vi.hoisted(() => [] as Array<{ subject: string; html: string }>);
const env = vi.hoisted(() => ({
  stripeSecretKey: "", stripeBasicPriceId: "", stripeProPriceId: "", stripeExclusivePriceId: "", stripeStandardPriceId: "",
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
  Object.assign(env, { stripeSecretKey: "", stripeBasicPriceId: "", stripeProPriceId: "", stripeExclusivePriceId: "", stripeStandardPriceId: "" });
});

describe("письмо о конце пробного", () => {
  it("ведёт куда сказано, цены — в сумах из общего источника", async () => {
    const { sendTrialEndingEmail } = await import("../lib/mailer");
    await sendTrialEndingEmail("ceo@org.uz", "ООО <Рога>", 2, "https://wp.test/billing", 7);

    expect(sent).toHaveLength(1);
    const html = sent[0].html;
    expect(html).toContain('href="https://wp.test/billing"');
    expect(html).not.toContain("$");
    // Цена за человека и сумма для этих семи полевых — 833 000.
    expect(html).toContain(formatSum(FIELD_PRICE_UZS));
    expect(html).toContain(formatSum(monthlyPrice(7)));
    expect(monthlyPrice(7)).toBe(833_000);
    for (const p of Object.values(LEGACY_PRICES_UZS)) {
      expect(html, `в письме прежняя цена ${p}`).not.toContain(p.toLocaleString("ru-RU"));
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

describe("письмо о конце оплаченного срока", () => {
  it("прежний тариф — по прежней цене до даты и сразу сумма за полевых после", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T09:00:00Z"));
    try {
      const { sendRenewalReminderEmail } = await import("../lib/mailer");
      await sendRenewalReminderEmail("ceo@org.uz", "Org", "pro", 3, new Date("2026-10-08T00:00:00Z"), "https://wp.test/billing", 26);
      const html = sent[0].html;
      expect(html).toContain(formatSum(LEGACY_PRICES_UZS.pro));
      expect(html).toContain("05.10.2027");
      expect(html).toContain(formatSum(3_094_000));
    } finally {
      vi.useRealTimers();
    }
  });

  it("«Стандарт» — месяц и год за своих полевых", async () => {
    const { sendRenewalReminderEmail } = await import("../lib/mailer");
    await sendRenewalReminderEmail("ceo@org.uz", "Org", "standard", 3, new Date(Date.now() + 3 * 86_400_000), "https://wp.test/billing", 7);
    const html = sent[0].html;
    expect(html).toContain(formatSum(833_000));
    expect(html).toContain(formatSum(8_496_600));
  });
});
