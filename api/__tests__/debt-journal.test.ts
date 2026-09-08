/**
 * Журнал задолженности: кто когда взял в долг и кто когда заплатил.
 *
 * ── Чего не было ────────────────────────────────────────────────────────────
 *
 * Про ОДИН магазин ответ появился — акт сверки в его карточке. Про все сразу
 * не было ни одного: «Долги магазинов» и «Дебиторка» показывают остаток на
 * сейчас, и ни один отчёт не говорил, КОГДА это случилось. Чтобы увидеть,
 * приходилось открывать карточки точек по одной.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Правила отбора движений — те же, что у акта и у recalcShopDebt, и здесь они
 * не свои: orderIsOwed и obligationDate берутся из shop-statement.ts. Проверка
 * следит, что журнал ими и пользуется, а не завёл третью копию условий: в этом
 * коде расчёт долга и его объяснение уже расходились именно так.
 *
 * Отдельно — обрезка. Журнал ограничен пределом строк, и молча укоротить
 * список значит соврать про период: признак truncated обязан об этом сказать.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../queries/connection";
import { debtJournal } from "../services/debt-journal";

const d = (iso: string) => new Date(iso);

const SHOP = { shopId: 1, shopName: "Mega Do'kon", city: "Ташкент", agentName: "Санжар" };

interface Fixture {
  orders?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  returns?: Array<Record<string, unknown>>;
  owedOrderIds?: number[];
}

/**
 * Поддельная база под ровно те запросы, что делает модуль.
 *
 * Запросы различаются по составу выбираемых столбцов — так же, как их различил
 * бы человек, читающий код.
 */
function fakeDb(f: Fixture) {
  let shape = "";
  const chain: Record<string, unknown> = {
    select: vi.fn((cols?: Record<string, unknown>) => {
      const keys = Object.keys(cols ?? {});
      if (keys.includes("paymentMethod")) shape = "orders";
      else if (keys.includes("type")) shape = "payments";
      else if (keys.includes("doc") && keys.includes("amount")) shape = "returns";
      else shape = "owed";
      return chain;
    }),
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => {
      switch (shape) {
        case "orders":   return f.orders ?? [];
        case "payments": return f.payments ?? [];
        case "returns":  return f.returns ?? [];
        default:         return [];
      }
    }),
    where: vi.fn(() => (shape === "owed" ? (f.owedOrderIds ?? []).map(id => ({ id })) : chain)),
  };
  return chain;
}

describe("журнал задолженности", () => {
  beforeEach(() => vi.clearAllMocks());

  it("отгрузка в долг и оплата попадают в журнал с разными знаками", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      orders: [{ ...SHOP, createdAt: d("2026-01-10"), deliveredAt: null, paymentMethod: "debt", doc: "З-1", total: "100000.00" }],
      payments: [{ ...SHOP, createdAt: d("2026-01-20"), type: "payment", amount: "40000.00", note: "наличными", orderId: null, orderDeletedAt: null }],
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows).toHaveLength(2);
    // Свежее сверху: журнал читают с последнего события, а не с первого.
    expect(j.rows[0]).toMatchObject({ kind: "payment", amount: -40000, shopName: "Mega Do'kon", agentName: "Санжар" });
    expect(j.rows[1]).toMatchObject({ kind: "order", amount: 100000, doc: "З-1" });
    expect(j.totals).toEqual({ taken: 100000, paid: 40000 });
  });

  it("обычный заказ входит датой отгрузки, а долговой — датой оформления", async () => {
    // Правило одно на всю систему и живёт в shop-statement.obligationDate.
    vi.mocked(getDb).mockReturnValue(fakeDb({
      orders: [
        { ...SHOP, createdAt: d("2026-01-01"), deliveredAt: d("2026-01-25"), paymentMethod: "cash", doc: "З-НАЛ", total: "10000.00" },
        { ...SHOP, createdAt: d("2026-01-05"), deliveredAt: null, paymentMethod: "debt", doc: "З-ДОЛГ", total: "20000.00" },
      ],
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows.map(r => [r.doc, r.date])).toEqual([
      ["З-НАЛ", d("2026-01-25")],
      ["З-ДОЛГ", d("2026-01-05")],
    ]);
  });

  it("платёж по удалённому заказу не считается", async () => {
    /*
      Удаление заказа — штатный способ исправить ошибку ВВОДА: заказа не было
      вовсе, значит не было и оплаты по нему. Засчитать её значило бы выдать
      магазину придуманный кредит. Так же поступают recalcShopDebt и акт сверки.
    */
    vi.mocked(getDb).mockReturnValue(fakeDb({
      payments: [
        { ...SHOP, createdAt: d("2026-02-01"), type: "payment", amount: "5000.00", note: null, orderId: 9, orderDeletedAt: d("2026-02-02") },
        { ...SHOP, createdAt: d("2026-02-03"), type: "payment", amount: "7000.00", note: null, orderId: 10, orderDeletedAt: null },
      ],
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].amount).toBe(-7000);
  });

  it("ручное начисление считается только без привязки к заказу", async () => {
    // С заказом обязательство уже учтено самим заказом — иначе оно удвоится.
    vi.mocked(getDb).mockReturnValue(fakeDb({
      payments: [
        { ...SHOP, createdAt: d("2026-03-01"), type: "debt", amount: "3000.00", note: "по тетради", orderId: null, orderDeletedAt: null },
        { ...SHOP, createdAt: d("2026-03-02"), type: "debt", amount: "9999.00", note: null, orderId: 4, orderDeletedAt: null },
      ],
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows).toHaveLength(1);
    expect(j.rows[0]).toMatchObject({ kind: "debt", amount: 3000, note: "по тетради" });
  });

  it("возврат по заказу, который уже ничего не должен, не вычитается", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      returns: [
        { ...SHOP, createdAt: d("2026-04-01"), doc: "В-1", amount: "1000.00", note: null, orderId: 77 },
        { ...SHOP, createdAt: d("2026-04-02"), doc: "В-2", amount: "2000.00", note: null, orderId: 88 },
      ],
      owedOrderIds: [88],   // заказ 77 отменён, 88 ещё должен
    }) as never);

    const j = await debtJournal(1);

    expect(j.rows.map(r => r.doc)).toEqual(["В-2"]);
    expect(j.rows[0].amount).toBe(-2000);
  });

  it("период отрезает движения по дате обязательства, а не по дате заказа", async () => {
    /*
      Заказ оформлен в январе, отгружен в марте. В долг он превратился в марте
      — значит и в журнал за март он обязан попасть, хотя created_at у него
      январский. Отбор по created_at показал бы январь и потерял бы март.
    */
    vi.mocked(getDb).mockReturnValue(fakeDb({
      orders: [{ ...SHOP, createdAt: d("2026-01-15"), deliveredAt: d("2026-03-15"), paymentMethod: "cash", doc: "З-7", total: "50000.00" }],
    }) as never);

    const inMarch = await debtJournal(1, { from: d("2026-03-01"), to: d("2026-03-31") });
    const inJanuary = await debtJournal(1, { from: d("2026-01-01"), to: d("2026-01-31") });

    expect(inMarch.rows.map(r => r.doc)).toEqual(["З-7"]);
    expect(inJanuary.rows).toHaveLength(0);
  });

  it("обрезанный журнал говорит об этом вслух", async () => {
    // Молча укоротить список значит соврать про период: человек решит, что за
    // месяц было три движения, а их было три тысячи.
    vi.mocked(getDb).mockReturnValue(fakeDb({
      payments: Array.from({ length: 5 }, (_, i) => ({
        ...SHOP, createdAt: d(`2026-05-0${i + 1}`), type: "payment", amount: "100.00", note: null, orderId: null, orderDeletedAt: null,
      })),
    }) as never);

    const j = await debtJournal(1, { limit: 2 });

    expect(j.rows).toHaveLength(2);
    expect(j.truncated).toBe(true);
  });

  it("полный журнал не притворяется обрезанным", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      payments: [{ ...SHOP, createdAt: d("2026-05-01"), type: "payment", amount: "100.00", note: null, orderId: null, orderDeletedAt: null }],
    }) as never);

    const j = await debtJournal(1, { limit: 100 });

    expect(j.truncated).toBe(false);
  });
});

describe("правила отбора не размножились", () => {
  it("журнал берёт условия из акта сверки, а не заводит свои", async () => {
    /*
      В этом коде расчёт долга и его объяснение уже расходились именно так:
      две почти одинаковые формулы одного и того же живут порознь ровно до
      первой правки в одной из них.
    */
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "..", "services", "debt-journal.ts"), "utf8");

    expect(src).toMatch(/import \{[^}]*orderIsOwed[^}]*\} from ".\/shop-statement"/s);
    expect(src).toMatch(/import \{[^}]*obligationDate[^}]*\} from ".\/shop-statement"/s);
    // Своя копия условия «заказ является обязательством» — то, чего здесь быть
    // не должно.
    expect(src, "условие отбора заказов скопировали в журнал")
      .not.toMatch(/notInArray\(orders\.status/);
  });
});
