import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import * as schema from "@db/schema";

/**
 * Контроль на настоящей базе: слово магазина по подписанной ссылке из чека
 * (подтвердил → один раз; оспорил → заметка, журнал, директору в Telegram;
 * недоставленный — отказ; выключено — отказ) → индекс риска: спор и
 * недостача при расчёте заказа дают курьеру баллы, чистый агент — ноль → список
 * споров → публичная страница чека несёт кнопки только при включённом
 * контроле и только пока слова нет.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
const tg = vi.hoisted(() => ({ notify: vi.fn(async (..._a: unknown[]) => undefined) }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: tg.notify }));

describe.skipIf(!hasRealDb)("контроль: слово магазина и индекс риска", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId = 0;
  const ceo = () => ({ id: ceoId, name: "Директор", role: "ceo" });
  const order = async (opts: { status?: string; courierId?: number; deliveredAt?: Date; number: string }) => {
    const [r] = await (db as any).insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, courierId: opts.courierId ?? s.courierId, orderNumber: opts.number,
      status: (opts.status ?? "delivered") as never, deliveryStatus: (opts.status ?? "delivered") === "delivered" ? "delivered" : "assigned", paymentMethod: "cash",
      subtotal: "300.00", total: "300.00", deliveredAt: opts.deliveredAt ?? null,
    });
    return Number(r.insertId);
  };

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    tg.notify.mockClear();
    s = await seed("10.000");
    const [c] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Директор", email: "ceo@test.local", passwordHash: "x", role: "ceo" });
    ceoId = Number(c.insertId);
    await (db as any).insert(schema.settings).values({ tenantId: s.tenantId, companyName: "Тест", controlEnabled: true }).catch(() => {});
    await (db as any).update(schema.settings).set({ controlEnabled: true }).where(eq(schema.settings.tenantId, s.tenantId));
  });

  it("подтвердил → оспорил → индекс риска → споры → страница чека", async () => {
    const { shopWord, ControlService, assertControl } = await import("../../services/control");
    const { receiptToken, receiptWord, receiptPage } = await import("../../services/receipt");
    const { OrderCloseService } = await import("../../services/order-close");
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    const okId = await order({ number: "№1001", deliveredAt: threeDaysAgo });
    const badId = await order({ number: "№1002", deliveredAt: threeDaysAgo });
    const openId = await order({ number: "№1003", status: "shipped" });
    const oldId = await order({ number: "№1004", deliveredAt: threeDaysAgo });

    // Подтверждение по подписанной ссылке — один раз; повтор ничего не меняет; кривая подпись — никуда.
    expect(await receiptWord(db as any, receiptToken(okId), { action: "confirm" })).toEqual({ redirect: `/r/${receiptToken(okId)}` });
    let [o] = await (db as any).select().from(schema.orders).where(eq(schema.orders.id, okId));
    expect(o.shopConfirmedAt).not.toBeNull();
    expect(await shopWord(db as any, okId, { action: "dispute", note: "передумал" })).toEqual({ state: "confirmed", changed: false });
    [o] = await (db as any).select().from(schema.orders).where(eq(schema.orders.id, okId));
    expect(o.shopDisputedAt).toBeNull();
    expect(await receiptWord(db as any, `${okId}.0000000000000000000000`, { action: "confirm" })).toEqual({ redirect: `/r/${okId}.0000000000000000000000` });

    // Спор: без заметки — отказ обратно на страницу с текстом; с заметкой — записан, журнал, директору в Telegram.
    const back = await receiptWord(db as any, receiptToken(badId), { action: "dispute", note: "  " });
    expect(back.redirect).toContain(`/r/${receiptToken(badId)}?e=`);
    expect(decodeURIComponent(back.redirect)).toContain("Напишите, что именно не сходится");
    expect(await shopWord(db as any, badId, { action: "dispute", note: " Нет двух ящиков, сумма не та " })).toEqual({ state: "disputed", changed: true });
    [o] = await (db as any).select().from(schema.orders).where(eq(schema.orders.id, badId));
    expect(o).toMatchObject({ shopDisputeNote: "Нет двух ящиков, сумма не та", shopConfirmedAt: null });
    expect(o.shopDisputedAt).not.toBeNull();
    expect(tg.notify).toHaveBeenCalledTimes(1);
    expect(String(tg.notify.mock.calls[0][2])).toContain("«Магазин Альфа» оспорил доставку №1002");
    expect(String(tg.notify.mock.calls[0][2])).toContain("доставил Курьер");

    // Недоставленный — отказ; неизвестный — отказ.
    await expect(shopWord(db as any, openId, { action: "confirm" })).rejects.toThrow(/только доставленный/);
    await expect(shopWord(db as any, 999_999, { action: "confirm" })).rejects.toThrow(/Такого заказа нет/);

    // Недостача курьера: заявил 300 наличными при доставке, офис получил 230 — 70 остаются на нём.
    await (db as any).insert(schema.payments).values({ tenantId: s.tenantId, shopId: s.shopId, orderId: oldId, amount: "300.00", type: "payment", paymentMethod: "cash", status: "paid", createdBy: s.courierId });
    expect(await OrderCloseService.close(db as any, s.tenantId, ceo(), { orderId: oldId, cashReceived: 230 })).toMatchObject({ shortage: 70, remainder: 0, claimed: 300 });

    // Индекс: курьер — спор (20) + недостача (15) = 35, «присмотреться»; агент — чист.
    const ov = await ControlService.overview(db as any, s.tenantId, { from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 86_400_000) });
    const courier = ov.employees.find(e => e.id === s.courierId)!;
    expect(courier.factors.map(f => [f.code, f.points])).toEqual([["dispute", 20], ["shortage", 15]]);
    expect(courier).toMatchObject({ score: 35, level: "watch", delivered: 3, confirmed: 1, disputed: 1, unconfirmed: 1, shortage: 70, onHand: 0 });
    expect(ov.employees.find(e => e.id === s.agentId)).toMatchObject({ score: 0, level: "calm", factors: [] });
    expect(ov.totals).toEqual({ disputed: 1, unconfirmed: 1, confirmed: 1, delivered: 3, atRisk: 1 });
    expect(ov.employees[0].id).toBe(s.courierId);

    // Споры за срок — с магазином, курьером и заметкой.
    const disputes = await ControlService.disputes(db as any, s.tenantId, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(disputes.map(d => [d.number, d.shopName, d.courierName, d.note, d.total])).toEqual([["№1002", "Магазин Альфа", "Курьер", "Нет двух ящиков, сумма не та", 300]]);

    // Страница чека: без слова — кнопки; со словом — итог; недоставленный — ни того, ни другого; контроль выключен — чек без блока.
    let page = await receiptPage(db as any, receiptToken(oldId));
    expect(page.status).toBe(200);
    expect(page.html).toContain('name="action" value="confirm"');
    page = await receiptPage(db as any, receiptToken(badId));
    expect(page.html).toContain("Замечание отправлено поставщику");
    expect(page.html).not.toContain('name="action"');
    page = await receiptPage(db as any, receiptToken(openId));
    expect(page.html).not.toContain('class="w"');
    await (db as any).update(schema.settings).set({ controlEnabled: false }).where(eq(schema.settings.tenantId, s.tenantId));
    page = await receiptPage(db as any, receiptToken(oldId));
    expect(page.html).not.toContain('class="w"');
    await expect(shopWord(db as any, oldId, { action: "confirm" })).rejects.toThrow(/не включено/);
    await expect(assertControl(db as any, s.tenantId, "pro")).rejects.toThrow(/выключен/);
    await expect(assertControl(db as any, s.tenantId, "basic")).rejects.toThrow(/Pro и Exclusive/);

    // Журнал действий помнит слово магазина — от имени магазина, без сотрудника.
    const rows = await (db as any).select({ a: schema.auditLog.action, who: schema.auditLog.actorName, actor: schema.auditLog.actorId }).from(schema.auditLog).where(eq(schema.auditLog.tenantId, s.tenantId));
    const word = rows.filter((r: any) => String(r.a).startsWith("control."));
    expect(word.map((r: any) => [r.a, r.who, r.actor])).toEqual([["control.shop_confirmed", "Магазин «Магазин Альфа»", null], ["control.shop_disputed", "Магазин «Магазин Альфа»", null]]);
  });
});
