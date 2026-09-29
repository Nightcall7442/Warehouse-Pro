import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import * as schema from "@db/schema";
import { invalidateReports } from "../../lib/report-cache";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

/**
 * «Заказы» как рабочее место: сортировка, размер страницы, поиск по телефону
 * и владельцу — на настоящей базе, через ту же ручку, что зовёт экран.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 *   · Список шёл только по дате создания, новые сверху. Крупные суммы,
 *     заказы одного магазина подряд, недоставленные курьером — только
 *     листанием по 25 строк.
 *   · Страница — всегда 25 строк.
 *   · Поиск — по номеру и названию магазина. Оператору звонят со словами
 *     «это Алишер, 90 123 45 67», а ни имя хозяина, ни телефон не искались.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   · каждая сортировка (сумма, магазин, создан, доставлен, курьер, статус)
 *     в обе стороны — порядок номеров целиком; «нет значения» — в конце;
 *   · равные значения не рвут страницы: 30 заказов на одну сумму в одну
 *     секунду по 25 строк — две страницы без повторов, позже заведённый выше;
 *   · без sortBy — как было: новые сверху; чужой столбец — отказ на входе;
 *   · pageSize 100 отдаёт 100 строк; выше потолка — отказ;
 *   · телефон по цифрам в разных записях, с кодом страны и без; владелец;
 *     короткий набор цифр — номер заказа, а не телефон;
 *   · изоляция: магазин соседней организации с тем же телефоном и хозяином
 *     не находится — ни в таблице, ни в плитках, ни в «По агентам», в том
 *     числе через битую ссылку заказа на чужой магазин; агент — только своё;
 *   · плитки и «По агентам» считают найденное тем же правилом, что таблица.
 *
 * Нарочная поломка (проверено, 29.09.2026):
 *   · хвост без desc(orders.id) — падает «равные значения» (порядок равных
 *     MySQL не обещает; на 9.4 он выходит по возрастанию номера строки, и
 *     страницы при этом не рвутся — поэтому сверяется сам порядок);
 *   · без emptyLast у доставки — падает «доставлен»;
 *   · статус по столбцу перечисления вместо FIELD — падает «статус»;
 *   · в order.list прежний поиск «номер или название» — падают телефон,
 *     владелец, агент и соседняя организация;
 *   · без s2.tenant_id в agentSummary — падает «битая ссылка»;
 *   · без порога пяти цифр в phoneDigits — падает «короткий набор цифр»;
 *     без снятия кода страны — падает «с кодом страны»;
 *   · без .max(5000) у pageSize — падает «выше потолка».
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

describe.skipIf(!hasRealDb)("order.list: сортировка, размер страницы, поиск", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId = 0;

  const d = () => db as any;
  const caller = async (userId = operatorId, role = "operator") =>
    (await import("../../order-router")).orderRouter.createCaller(ctxFor(db, s.tenantId, userId, role));
  const insertShop = async (values: Record<string, unknown>) => {
    const [r] = await d().insert(schema.shops).values({ tenantId: s.tenantId, ...values });
    return Number(r.insertId);
  };
  const insertOrder = async (orderNumber: string, values: Record<string, unknown>) => {
    const [r] = await d().insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber,
      status: "new", paymentMethod: "cash", subtotal: "300.00", total: "300.00", ...values,
    });
    return Number(r.insertId);
  };
  const numbers = (r: { data: Array<{ orderNumber: string }> }) => r.data.map(o => o.orderNumber);

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    // Плитки и «По агентам» кэшируются на 20 секунд по входу; номера
    // организаций после очистки те же — чужой прошлый ответ не должен
    // подставиться в этот тест.
    await invalidateReports(s.tenantId, "test");
    const [op] = await d().insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
  });

  describe("сортировка по столбцам", () => {
    beforeEach(async () => {
      const alfa = await insertShop({ name: "Альфа" });
      const beta = await insertShop({ name: "Бета" });
      const gamma = await insertShop({ name: "Гамма" });
      const [anvar] = await d().insert(schema.users).values({ tenantId: s.tenantId, name: "Анвар", email: "anvar@test.local", passwordHash: "x", role: "courier" });
      const [boris] = await d().insert(schema.users).values({ tenantId: s.tenantId, name: "Борис", email: "boris@test.local", passwordHash: "x", role: "courier" });
      const A = Number(anvar.insertId), B = Number(boris.insertId);
      //            сумма    магазин  создан     доставлен   курьер  статус
      await insertOrder("№1", { total: "500.00", shopId: beta, createdAt: new Date(2026, 8, 1, 10), deliveredAt: new Date(2026, 8, 3, 10), courierId: B, status: "delivered" });
      await insertOrder("№2", { total: "1500.00", shopId: alfa, createdAt: new Date(2026, 8, 2, 10), status: "new" });
      await insertOrder("№3", { total: "100.00", shopId: gamma, createdAt: new Date(2026, 8, 3, 10), deliveredAt: new Date(2026, 8, 4, 10), courierId: A, status: "pending" });
      await insertOrder("№4", { total: "900.00", shopId: beta, createdAt: new Date(2026, 8, 4, 10), deliveredAt: new Date(2026, 8, 2, 10), courierId: A, status: "processing" });
      await insertOrder("№5", { total: "50.00", shopId: gamma, createdAt: new Date(2026, 8, 5, 10), courierId: B, status: "shipped" });
    });
    const sorted = async (sortBy?: string, sortDir?: "asc" | "desc") =>
      numbers(await (await caller()).list({ pageSize: 100, sortBy: sortBy as never, sortDir }));

    it("без выбора — как было: новые сверху", async () => {
      expect(await sorted()).toEqual(["№5", "№4", "№3", "№2", "№1"]);
      expect(await sorted("createdAt", "desc")).toEqual(["№5", "№4", "№3", "№2", "№1"]);
      expect(await sorted("createdAt", "asc")).toEqual(["№1", "№2", "№3", "№4", "№5"]);
    });

    it("сумма — числом, а не строкой: 1500 выше 900, 50 ниже 100", async () => {
      expect(await sorted("total", "desc")).toEqual(["№2", "№4", "№1", "№3", "№5"]);
      expect(await sorted("total", "asc")).toEqual(["№5", "№3", "№1", "№4", "№2"]);
    });

    it("магазин — по алфавиту; заказы одного магазина подряд, свежие первыми", async () => {
      expect(await sorted("shopName", "asc")).toEqual(["№2", "№4", "№1", "№5", "№3"]);
      expect(await sorted("shopName", "desc")).toEqual(["№5", "№3", "№4", "№1", "№2"]);
    });

    it("доставлен — недоставленные в конце в обе стороны", async () => {
      expect(await sorted("deliveredAt", "desc")).toEqual(["№3", "№1", "№4", "№5", "№2"]);
      expect(await sorted("deliveredAt", "asc")).toEqual(["№4", "№1", "№3", "№5", "№2"]);
    });

    it("курьер — по имени; без курьера в конце в обе стороны", async () => {
      expect(await sorted("courierName", "asc")).toEqual(["№4", "№3", "№5", "№1", "№2"]);
      expect(await sorted("courierName", "desc")).toEqual(["№5", "№1", "№4", "№3", "№2"]);
    });

    it("статус — ходом работы: ожидает → новый → в обработке → отгружен → доставлен", async () => {
      expect(await sorted("status", "asc")).toEqual(["№3", "№2", "№4", "№5", "№1"]);
      expect(await sorted("status", "desc")).toEqual(["№1", "№5", "№4", "№2", "№3"]);
    });

    it("в ORDER BY уходит только известное: чужой столбец и направление — отказ на входе", async () => {
      const c = await caller();
      await expect(c.list({ sortBy: "id; DROP TABLE orders" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(c.list({ sortBy: "orderNumber" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(c.list({ sortBy: "total", sortDir: "sideways" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  it("равные значения: порядок полный — страницы без повторов, позже заведённый выше", async () => {
    // Порядок равных MySQL не обещает. На этой версии он случайно выходит
    // ровным, поэтому проверяется сам порядок, а не только отсутствие повторов:
    // хвост «дата, номер строки» задаёт его явно, и без хвоста он другой.
    const at = new Date(2026, 8, 10, 12, 0, 0);
    await d().insert(schema.orders).values(Array.from({ length: 30 }, (_, i) => ({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: `№${100 + i}`,
      status: "new", paymentMethod: "cash", subtotal: "700.00", total: "700.00", createdAt: at,
    })));
    const newestFirst = Array.from({ length: 30 }, (_, i) => `№${129 - i}`);
    const c = await caller();
    const pages = async (sortBy: "total" | "shopName" | "createdAt" | "status") => [
      ...numbers(await c.list({ sortBy, sortDir: "asc", page: 1, pageSize: 25 })),
      ...numbers(await c.list({ sortBy, sortDir: "asc", page: 2, pageSize: 25 })),
    ];
    for (const sortBy of ["total", "shopName", "status"] as const) {
      expect(await pages(sortBy), sortBy).toEqual(newestFirst);
    }
    // Дата создания: равные — по номеру строки в ту же сторону, что и дата.
    expect(await pages("createdAt")).toEqual([...newestFirst].reverse());
  });

  it("pageSize 100 отдаёт сто строк; выше потолка — отказ", async () => {
    await d().insert(schema.orders).values(Array.from({ length: 120 }, (_, i) => ({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: `№${1000 + i}`,
      status: "new", paymentMethod: "cash", subtotal: "10.00", total: "10.00", createdAt: new Date(2026, 8, 1, 0, i),
    })));
    const c = await caller();
    const first = await c.list({ page: 1, pageSize: 100 });
    expect(first.data).toHaveLength(100);
    expect(first).toMatchObject({ total: 120, pageSize: 100 });
    expect(first.data[0].orderNumber).toBe("№1119");
    const second = await c.list({ page: 2, pageSize: 100 });
    expect(second.data).toHaveLength(20);
    // Потолок один на ручку: выгрузка экрана («Excel», «PDF») берёт её же с 5000.
    await expect(c.list({ pageSize: 5001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(c.list({ pageSize: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  describe("поиск: телефон по цифрам, владелец, изоляция", () => {
    let foreignShop = 0;
    beforeEach(async () => {
      // Один номер, записанный по-разному, — и соседний номер, который не должен найтись.
      const p1 = await insertShop({ name: "Хумо", phone: "+998901234567" });
      const p2 = await insertShop({ name: "Нур", phone: "+998 90 123 45 67" });
      const p3 = await insertShop({ name: "Барака", phone: "(90) 123-45-67", ownerName: "Алишер Каримов" });
      const p4 = await insertShop({ name: "Сафар", phone: "901234567" });
      const p5 = await insertShop({ name: "Соседний номер", phone: "+998 90 123 45 68" });
      const p6 = await insertShop({ name: "Заря", phone: "+998 90 149 00 00" });
      await insertOrder("№11", { shopId: p1 });
      await insertOrder("№12", { shopId: p2 });
      await insertOrder("№13", { shopId: p3 });
      await insertOrder("№14", { shopId: p4 });
      await insertOrder("№15", { shopId: p5 });
      await insertOrder("№21", { shopId: p6 });
      await insertOrder("№1490", {});
      await insertOrder("№16-удалён", { shopId: p1, deletedAt: new Date() });
      // Чужой агент той же организации — агенту его заказ не виден.
      const [other] = await d().insert(schema.users).values({ tenantId: s.tenantId, name: "Второй агент", email: "a2@test.local", passwordHash: "x", role: "agent" });
      await insertOrder("№17-чужого-агента", { shopId: p2, agentId: Number(other.insertId) });
      // Соседняя организация: тот же номер и тот же хозяин.
      const [fs] = await d().insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Хумо соседа", phone: "+998 90 123 45 67", ownerName: "Алишер Каримов" });
      foreignShop = Number(fs.insertId);
      await d().insert(schema.orders).values({ tenantId: s.otherTenantId, shopId: foreignShop, orderNumber: "№ЧУЖОЙ", agentId: s.agentId, status: "new", paymentMethod: "cash", subtotal: "1.00", total: "1.00" });
    });
    const find = async (search: string, userId = operatorId, role = "operator") =>
      numbers(await (await caller(userId, role)).list({ search, pageSize: 100, sortBy: "createdAt", sortDir: "asc" })).sort();

    it("«90 123 45 67» находит номер в любой записи; соседний номер — нет", async () => {
      const all = ["№11", "№12", "№13", "№14", "№17-чужого-агента"];
      expect(await find("90 123 45 67")).toEqual(all);
      expect(await find("+998 90 123 45 67"), "с кодом страны — и записанный без кода").toEqual(all);
      expect(await find("998901234567")).toEqual(all);
      expect(await find("90-123-45-67")).toEqual(all);
      expect(await find("1234567"), "хвост номера").toEqual(all);
      expect(await find("90 123 45 68")).toEqual(["№15"]);
    });

    it("по владельцу — по имени и фамилии", async () => {
      expect(await find("Каримов")).toEqual(["№13"]);
      expect(await find("Алишер")).toEqual(["№13"]);
    });

    it("номер заказа и название — как прежде; короткий набор цифр — номер заказа, а не телефон", async () => {
      expect(await find("Хумо")).toEqual(["№11"]);
      expect(await find("№13")).toEqual(["№13"]);
      // В телефоне «Зари» (её заказ №21) есть 1490, но четыре цифры — это номер заказа.
      expect(await find("1490")).toEqual(["№1490"]);
    });

    it("агент по телефону находит только свои заказы", async () => {
      expect(await find("90 123 45 67", s.agentId, "agent")).toEqual(["№11", "№12", "№13", "№14"]);
    });

    it("плитки и «По агентам» считают найденное тем же правилом", async () => {
      const c = await caller();
      expect(await c.stats({ search: "90 123 45 67" })).toMatchObject({ total: 5, newCount: 5 });
      expect(await c.stats({ search: "Каримов" })).toMatchObject({ total: 1 });
      const byAgent = await c.agentSummary({ search: "90 123 45 67" });
      const mine = byAgent.find(a => a.agentId === s.agentId);
      expect(mine?.orderCount).toBe(4);
      expect((await c.agentSummary({ search: "Каримов" })).find(a => a.agentId === s.agentId)?.orderCount).toBe(1);
    });

    it("соседняя организация не находится — и через битую ссылку заказа на её магазин", async () => {
      // Заказ своей организации, чей shop_id указывает на магазин соседа:
      // по такой ссылке чужой телефон и чужой хозяин не должны «найтись».
      await insertOrder("№БИТАЯ-ССЫЛКА", { shopId: foreignShop });
      const c = await caller();
      expect(await find("Каримов")).toEqual(["№13"]);
      expect(await find("Хумо соседа")).toEqual([]);
      expect(await c.stats({ search: "Хумо соседа" })).toMatchObject({ total: 0 });
      const byAgent = await c.agentSummary({ search: "Хумо соседа" });
      expect(byAgent.find(a => a.agentId === s.agentId)?.orderCount ?? 0).toBe(0);
      expect((await c.agentSummary({ search: "Каримов" })).find(a => a.agentId === s.agentId)?.orderCount).toBe(1);
    });
  });
});
