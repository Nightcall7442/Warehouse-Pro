import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, ctxFor, TEST_DATABASE_URL, type ServiceDb, type Seeded } from "./harness";
import * as schema from "@db/schema";

/**
 * Очереди «Заказов» и живое обновление — на настоящей базе.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 *   · С 1-го числа экран слал «Активным» и очередям период с первого числа
 *     месяца — заказы прошлого месяца пропадали из работы. Экран теперь без
 *     периода по умолчанию (src/__tests__/orders-queues-and-export.test.tsx);
 *     здесь — что сервер по такому входу их отдаёт.
 *   · «Ждут расчёта» на вкладке «Активные» было пустым ВСЕГДА: очередь
 *     (доставлен, не рассчитан) пересекалась с «открытыми статусами».
 *   · Сервер не слал событий заказа вовсе: экран «Заказы» и Главная не
 *     узнавали о новом заказе агента и о расчёте, пока их не щёлкнуть.
 *   · Расчёт по заказу не сбрасывал кэш отчётов: плитка «Ждут расчёта» ещё
 *     20 секунд держала рассчитанный заказ.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · заказ прошлого месяца — в «Активных», «Ожидает», «Ждут расчёта» и их
 *     числах; выбранные даты по-прежнему фильтруют;
 *   · «Ждут расчёта» — на любой вкладке, без рассчитанных и удалённых;
 *   · выборка по номерам отмеченных — только своё и только своей организации;
 *   · создание, смена статуса, расчёт — событие order.changed, после
 *     коммита (тот, кто получил событие, читает уже новое), без сумм и имён;
 *     откат — события нет;
 *   · расчёт — плитка очереди падает сразу, а не через 20 секунд.
 *
 * Нарочная поломка: в OrderService.list верни f.archived вместо archived —
 * падает «Ждут расчёта»; убери рассылку из invalidateReports — падают
 * события; перенеси invalidateReports в cancel внутрь транзакции до
 * проверки статуса — падает «откат»; убери invalidateReports из
 * OrderCloseService.close — падает расчёт.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
vi.mock("../../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => true), notifyTenantRole: vi.fn(async () => undefined) }));
vi.mock("../../services/push-service", () => ({ sendPushToUser: vi.fn(async () => undefined), sendPushToRole: vi.fn(async () => undefined) }));
vi.mock("../../services/telegram-notify", async (orig) => ({ ...(await orig<object>()), notifyEvent: vi.fn(async () => undefined) }));

describe.skipIf(!hasRealDb)("очереди «Заказов» и живое обновление", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId = 0;
  /** Отдельное соединение: что видит тот, кто получил событие, — то есть закоммиченное. */
  let reader: mysql.Connection;
  const viewer = () => ({ userId: operatorId, userRole: "operator" });
  const insertOrder = async (number: string, values: Record<string, unknown>) => {
    const [r] = await (db as any).insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: number,
      status: "new", paymentMethod: "cash", subtotal: "300.00", total: "300.00", ...values,
    });
    return Number(r.insertId);
  };
  const numbers = (r: { data: Array<{ orderNumber: string }> }) => r.data.map(o => o.orderNumber).sort();

  beforeAll(async () => {
    db = await connectRealDb(); current = db;
    reader = await mysql.createConnection(TEST_DATABASE_URL);
  }, 180_000);
  afterAll(async () => { await reader?.end(); await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    const [o] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(o.insertId);
    vi.restoreAllMocks();
  });

  it("1 октября: заказ сентября — в «Активных», «Ожидает» и «Ждут расчёта», в их числах; выбранные даты фильтруют", async () => {
    const { OrderService } = await import("../../services/order");
    const { orderRouter } = await import("../../order-router");
    await insertOrder("№-ОЖИДАЕТ", { status: "pending", createdAt: new Date(2026, 8, 20, 12) });
    await insertOrder("№-ДЕНЬГИ", { status: "delivered", deliveredAt: new Date(2026, 8, 25, 12), createdAt: new Date(2026, 8, 25, 10) });
    await insertOrder("№-РАССЧИТАН", { status: "delivered", closedAt: new Date(2026, 8, 26), createdAt: new Date(2026, 8, 25, 10) });
    await insertOrder("№-УДАЛЁН", { status: "delivered", deletedAt: new Date(2026, 8, 27), createdAt: new Date(2026, 8, 25, 10) });
    await insertOrder("№-СЕГОДНЯ", { status: "new", createdAt: new Date(2026, 9, 1, 9) });
    const list = (f: Record<string, unknown>) => OrderService.list(db as any, s.tenantId, { pageSize: 100, ...f }, viewer());

    // То, что экран шлёт 1-го числа без выбранных дат.
    expect(numbers(await list({ archived: false }))).toEqual(["№-ОЖИДАЕТ", "№-СЕГОДНЯ"]);
    expect(numbers(await list({ archived: false, status: "pending" }))).toEqual(["№-ОЖИДАЕТ"]);
    // «Ждут расчёта» с вкладки «Активные» (плитка, ссылка из «Контроля») и из «Архива».
    expect(numbers(await list({ archived: false, awaitingMoney: true }))).toEqual(["№-ДЕНЬГИ"]);
    expect(numbers(await list({ archived: true, awaitingMoney: true }))).toEqual(["№-ДЕНЬГИ"]);
    // Выбранные человеком даты — фильтр, как и прежде.
    expect(numbers(await list({ archived: false, dateFrom: "2026-10-01", dateTo: "2026-10-01" }))).toEqual(["№-СЕГОДНЯ"]);

    const caller = orderRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
    expect(await caller.stats({})).toMatchObject({ pendingCount: 1, awaitingMoneyCount: 1 });
    // Прежний вход с первым числом — тот самый ложный ноль вечерней проверки.
    expect(await caller.stats({ dateFrom: "2026-10-01", dateTo: "2026-10-01" })).toMatchObject({ pendingCount: 0, awaitingMoneyCount: 0 });
  });

  it("отмеченные по номерам: своё и своей организации", async () => {
    const { OrderService } = await import("../../services/order");
    const a = await insertOrder("№-A", { createdAt: new Date(2026, 5, 1) });
    const b = await insertOrder("№-B", { status: "delivered" });
    const [other] = await (db as any).insert(schema.users).values({ tenantId: s.tenantId, name: "Второй агент", email: "a2@test.local", passwordHash: "x", role: "agent" });
    const c = await insertOrder("№-C", { agentId: Number(other.insertId) });
    const [foreignShop] = await (db as any).insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужой" });
    const [foreign] = await (db as any).insert(schema.orders).values({ tenantId: s.otherTenantId, shopId: Number(foreignShop.insertId), orderNumber: "№-ЧУЖОЙ", agentId: s.agentId, status: "new", subtotal: "1.00", total: "1.00" });
    await insertOrder("№-НЕ-ОТМЕЧЕН", {});
    const ids = [a, b, c, Number(foreign.insertId)];

    expect(numbers(await OrderService.list(db as any, s.tenantId, { ids, pageSize: 4 }, viewer()))).toEqual(["№-A", "№-B", "№-C"]);
    // Агент по номерам получает только свои — как и во всём списке.
    expect(numbers(await OrderService.list(db as any, s.tenantId, { ids, pageSize: 4 }, { userId: s.agentId, userRole: "agent" }))).toEqual(["№-A", "№-B"]);
  });

  describe("живое обновление", () => {
    type Seen = { type: string; tenantId: number; data: unknown; status: Promise<string | undefined> };
    let watchId = 0;
    beforeEach(() => { watchId = 0; });
    const listen = async () => {
      const { sseBus } = await import("../../lib/sse");
      const seen: Seen[] = [];
      vi.spyOn(sseBus, "emit").mockImplementation((e) => {
        if (e.type !== "order.changed") return;
        // Читаем ДРУГИМ соединением в момент события: до коммита оно увидело бы старое.
        // Пока номера нет (создание) — последний заказ организации.
        const status = reader.query(watchId ? "SELECT status FROM orders WHERE id = ?" : "SELECT status FROM orders WHERE tenant_id = ? ORDER BY id DESC LIMIT 1", [watchId || s.tenantId])
          .then(([rows]) => (rows as Array<{ status: string }>)[0]?.status);
        seen.push({ type: e.type, tenantId: e.tenantId, data: e.data, status });
      });
      return seen;
    };

    it("новый заказ агента и смена статуса — событие организации после коммита, без сумм и имён", async () => {
      const { OrderService } = await import("../../services/order");
      const seen = await listen();

      const created = await OrderService.create(db, s.tenantId, s.agentId, { shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }] });
      watchId = Number(created.id);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ type: "order.changed", tenantId: s.tenantId, data: {} });
      expect(await seen[0].status).toBe("new");

      await OrderService.updateStatus(db, s.tenantId, watchId, "processing");
      expect(seen).toHaveLength(2);
      expect(await seen[1].status).toBe("processing");
    });

    it("откат — события нет", async () => {
      const { OrderService } = await import("../../services/order");
      watchId = await insertOrder("№-В-РАБОТЕ", { status: "processing" });
      const seen = await listen();
      await expect(OrderService.cancel(db, s.tenantId, watchId, { userId: operatorId, userRole: "operator" })).rejects.toThrow(/только новые/);
      expect(seen).toEqual([]);
    });

    it("расчёт: событие и плитка «Ждут расчёта» падает сразу, а не через 20 секунд", async () => {
      const { OrderCloseService } = await import("../../services/order-close");
      const { orderRouter } = await import("../../order-router");
      watchId = await insertOrder("№-К-РАСЧЁТУ", { status: "delivered", deliveredAt: new Date(), courierId: s.courierId });
      await (db as any).insert(schema.payments).values({ tenantId: s.tenantId, shopId: s.shopId, orderId: watchId, amount: "300.00", type: "payment", paymentMethod: "cash", status: "paid", createdBy: s.courierId });
      const caller = orderRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
      // Кэш плиток заполнен — как у оператора, который смотрит на экран.
      expect(await caller.stats({})).toMatchObject({ awaitingMoneyCount: 1 });

      const seen = await listen();
      await OrderCloseService.close(db as any, s.tenantId, { id: operatorId, name: "Оператор", role: "operator" }, { orderId: watchId, cashReceived: 300 });
      expect(seen.map(e => e.type)).toEqual(["order.changed"]);
      expect(await caller.stats({})).toMatchObject({ awaitingMoneyCount: 0 });
    });
  });
});
