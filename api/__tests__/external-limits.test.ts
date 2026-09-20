import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Пределы снаружи — аудит 20.09.2026 (важно).
 *
 *  1. Лимит заказов тарифа (пробный — 50 в месяц) рисовался на странице
 *     биллинга и не проверялся нигде: пробная организация оформляла тысячи
 *     заказов. Теперь order.create спрашивает monthlyOrderRoom до создания.
 *  2. Заявка с лендинга ограничивалась только по телефону: меняя цифру,
 *     аноним писал заявки без счёта и слал по сообщению в Telegram на
 *     каждую. Теперь и по адресу (когда он известен за прокси).
 *  3. Письмо приглашения вставляло имя организации и приглашающего в HTML
 *     как есть — фишинг с отправителя платформы. Теперь текст экранируется.
 *  4. Аватар: 5 МБ любого содержимого любой роли → до 1 МБ и только картинка.
 *  5. Публичный API: ?limit=abc → NaN в LIMIT → 500 и тревога дежурному на
 *     каждый запрос. Теперь целое в границах, мусор — 50.
 *
 * Нарочная поломка: убери вызов monthlyOrderRoom из order.create — упадёт
 * «лимит заказов»; убери escapeHtml из письма — упадёт «письмо»; верни
 * Number(...) в public-api — упадёт «limit».
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("лимит заказов тарифа", () => {
  it("order.create спрашивает предел до создания и называет числа", () => {
    const src = read("api/order-router.ts");
    const at = src.indexOf("monthlyOrderRoom(ctx.db, ctx.tenant.id, ctx.tenant.plan)");
    const create = src.indexOf("const created = await OrderService.create(");
    expect(at, "создание заказа не спрашивает предел").toBeGreaterThan(0);
    expect(at).toBeLessThan(create);
    expect(src).toContain("Достигнут предел тарифа по заказам за месяц (${limits.current} из ${limits.limit})");
  });

  it("monthlyOrderRoom: пробный — 50 в месяц, ровно 50 уже есть — отказ; безлимитный тариф базу не спрашивает", async () => {
    const { monthlyOrderRoom } = await import("../lib/plan-limits");
    let asked = 0;
    const dbWith = (count: number) => ({ select: () => ({ from: () => ({ where: async () => { asked++; return [{ count }]; } }) }) });
    expect(await monthlyOrderRoom(dbWith(49) as never, 1, "trial")).toEqual({ allowed: true, current: 49, limit: 50 });
    expect(await monthlyOrderRoom(dbWith(50) as never, 1, "trial")).toEqual({ allowed: false, current: 50, limit: 50 });
    asked = 0;
    expect(await monthlyOrderRoom(dbWith(9999) as never, 1, "pro")).toEqual({ allowed: true, current: 0, limit: null });
    expect(asked, "безлимитный тариф считал заказы").toBe(0);
  });
});

describe("письмо приглашения", () => {
  it("имя организации и приглашающего — текст, не разметка", async () => {
    vi.resetModules();
    const sent: Array<{ html: string; subject: string }> = [];
    vi.doMock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: async (m: { html: string; subject: string }) => { sent.push(m); return { messageId: "x" }; } }) } }));
    vi.doMock("../lib/env", () => ({ env: { smtpHost: "smtp.test", smtpPort: 25, smtpUser: "u", smtpPass: "p", smtpFrom: "noreply@test", isProduction: false, appUrl: "http://localhost" } }));
    const { sendInviteEmail, escapeHtml } = await import("../lib/mailer");
    expect(escapeHtml(`<a href="https://evil">Ваш банк</a> & Co'`)).toBe("&lt;a href=&quot;https://evil&quot;&gt;Ваш банк&lt;/a&gt; &amp; Co&#39;");
    await sendInviteEmail("to@test", `<a href="https://evil">Ваш банк</a>`, `<img src=x onerror=alert(1)>`, "agent", "http://localhost/invite/t");
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain("<a href=\"https://evil\">");
    expect(sent[0].html).not.toContain("<img src=x");
    expect(sent[0].html).toContain("&lt;a href=&quot;https://evil&quot;&gt;");
    vi.doUnmock("nodemailer"); vi.doUnmock("../lib/env");
  });
});

describe("заявка с лендинга", () => {
  it("ограничена и по телефону, и по адресу", () => {
    const src = read("api/lead-router.ts");
    expect(src).toContain('namespace: "lead" }');
    expect(src).toContain("const ip = getClientIp(ctx.req);");
    expect(src).toContain('namespace: "lead-ip" }');
  });
});

describe("аватар", () => {
  it("до 1 МБ и только картинка", () => {
    const src = read("api/user-router.ts");
    expect(src).toContain("avatar: z.string().max(1_400_000");
    expect(src).toContain("isSafePhotoValue(v)");
    expect(src).not.toContain("max(5000000)");
  });
});

describe("публичный API: размер страницы", () => {
  it("мусор и отрицательное — 50, больше 200 — 200, целое — как есть; NaN в LIMIT не бывает", async () => {
    const src = read("api/public-api.ts");
    expect(src).not.toContain('Math.min(Number(c.req.query("limit")');
    expect((src.match(/pageLimit\(c\.req\.query\("limit"\)\)/g) ?? []).length).toBe(3);
    const { pageLimit } = await import("../public-api");
    expect([pageLimit("abc"), pageLimit("-5"), pageLimit(undefined), pageLimit("999"), pageLimit("25"), pageLimit("0")]).toEqual([50, 50, 50, 200, 25, 50]);
  });
});
