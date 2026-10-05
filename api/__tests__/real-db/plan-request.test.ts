import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { formatSum, monthlyPrice } from "@contracts/pricing";
import { countFieldUsersOf } from "../../lib/field-users";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, ctxFor, type ServiceDb, type Seeded } from "./harness";

/**
 * Заявка на тариф не теряется — на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * billing.requestUpgrade — единственный путь «купить» (платёжной системы в
 * сумах нет) — только слал сообщение в телеграм. sendTelegram при сбое не
 * бросает, а возвращает false, поэтому `.catch` не срабатывал никогда: бот не
 * настроен, телеграм лежит, бота заблокировали — намерение заплатить
 * исчезало, а человек читал «Оператор свяжется в течение 30 минут».
 * Контакт брался из tenants.owner_phone ?? owner_email — у организации с
 * сайта обоих нет, и приходило «📞 не указан».
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · заявка ложится в leads и при молчащем телеграме (notified = false), а
 *     ответ говорит «записана», не «отправлена»;
 *   · ушедшее уведомление отмечено в заявке;
 *   · тот же тариф — это продление, и так и подписано;
 *   · без контактов организации — телефон или почта самого директора;
 *   · почта длиннее столбца телефона (32) не роняет вставку — заявка есть,
 *     полный контакт в комментарии.
 *
 * Нарочная поломка: вернуть requestUpgrade на голый notifyAdmin — падают
 * первые три; вернуть контакт `ownerPhone ?? ownerEmail` — четвёртый; снять
 * обрезку в recordLead — пятый («Data too long»).
 */
const tg = vi.hoisted(() => ({ chatId: "", ok: false, sent: [] as string[] }));
vi.mock("../../lib/env", async (orig) => {
  const real = await orig<{ env: Record<string, unknown> }>();
  return { env: new Proxy(real.env, { get: (o, k) => (k === "telegramAdminChatId" ? tg.chatId : o[k as string]) }) };
});
vi.mock("../../lib/telegram", async (orig) => ({
  ...(await orig<object>()),
  sendTelegram: vi.fn(async (_chat: string, text: string) => { tg.sent.push(text); return tg.ok; }),
}));
vi.mock("../../lib/rate-limit", async () => (await import("../helpers/rate-limit-mock")).rateLimitMock());
// Полевых сервер считает сам (lib/field-users) — через общее подключение, как и статус подписки.
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("заявка на тариф на настоящей базе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    tg.chatId = ""; tg.ok = false; tg.sent.length = 0;
  });

  const ceo = (over: { tenant?: object; user?: object } = {}) => {
    const c = ctxFor(db, s.tenantId, 1, "ceo");
    return { ...c, tenant: { ...c.tenant, ...over.tenant }, user: { ...c.user, ...over.user } };
  };
  const ask = async (plan: "standard" | "basic" | "pro" | "exclusive", over?: Parameters<typeof ceo>[0]) => {
    const { billingRouter } = await import("../../billing-router");
    return billingRouter.createCaller(ceo(over)).requestUpgrade({ plan });
  };
  const leads = () => (db as any).select().from(schema.leads) as Promise<schema.Lead[]>;

  it("телеграм молчит — заявка записана, и ответ этого не скрывает", async () => {
    const r = await ask("standard");

    expect(r.notified).toBe(false);
    expect(r.message).toContain("записана");
    expect(r.message).not.toMatch(/30 минут|отправлена/);

    const rows = await leads();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company: "Тестовая компания", source: "подписка: тариф", notified: false });
    // Сумма — посчитанная сервером по полевым этой организации (contracts/pricing.ts).
    expect(rows[0].comment).toContain("Standard");
    expect(rows[0].comment).toContain(formatSum(r.price));
    expect(r.price).toBe(monthlyPrice(await countFieldUsersOf(db as never, s.tenantId)));
  });

  it("уведомление ушло — заявка помечена, ответ «отправлена»", async () => {
    tg.chatId = "777"; tg.ok = true;
    const r = await ask("standard");

    expect(r.notified).toBe(true);
    expect(r.message).toContain("отправлена");
    const [row] = await leads();
    expect(row.notified).toBe(true);
    expect(tg.sent.join("\n")).toContain("Запрос на тариф");
  });

  it("тот же тариф, что стоит, — это продление (прежний — по прежней цене до 05.10.2027)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T09:00:00Z"));
    try {
      const r = await ask("pro", { tenant: { plan: "pro" } });
      expect(r.success).toBe(true);
      expect(r.price).toBe(599_000);
      const [row] = await leads();
      expect(row.source).toBe("подписка: продление");
      expect(row.comment).toMatch(/^Продлить тариф Pro по прежней цене до 05\.10\.2027/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("у организации нет контактов — перезванивают директору", async () => {
    await ask("standard", { tenant: { ownerPhone: null, ownerEmail: null }, user: { phone: "+998 90 111 22 33" } });
    await ask("standard", { tenant: { ownerPhone: null, ownerEmail: null }, user: { phone: null, email: "dir@sok.uz" } });
    await ask("standard", { tenant: { ownerPhone: "+998 71 000 00 00" }, user: { phone: "+998 90 111 22 33" } });

    const phones = (await leads()).map(l => l.phone).sort();
    expect(phones).toEqual(["+998 71 000 00 00", "+998 90 111 22 33", "dir@sok.uz"].sort());
    expect(phones).not.toContain("не указан");
  });

  it("почта длиннее столбца телефона не роняет заявку", async () => {
    const email = "director.of.distribution@oltin-yol-savdo.uz"; // 43 знака, столбец — 32
    expect(email.length).toBeGreaterThan(32);
    const r = await ask("standard", { tenant: { ownerPhone: null, ownerEmail: null }, user: { phone: null, email } });

    expect(r.success).toBe(true);
    const [row] = await leads();
    expect(row.phone).toBe(email.slice(0, 32));
    expect(row.comment).toContain(`Связь: ${email}`);
  });

  it("прежний тариф чужой организации не подключить — заявка не ложится", async () => {
    await expect(ask("exclusive", { tenant: { plan: "trial" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await leads()).toHaveLength(0);
  });
});
