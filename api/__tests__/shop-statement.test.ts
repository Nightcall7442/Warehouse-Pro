/**
 * Акт сверки обязан объяснять то самое число, которое стоит в карточке.
 *
 * ── Чего не было ────────────────────────────────────────────────────────────
 *
 * Долг магазина — одно число в shops.debt, выведенное из заказов, платежей и
 * возвратов (services/shop-debt.ts). Показать, из чего оно сложилось, было
 * нечем: в карточке стоял блок «История платежей» — пять строк из таблицы
 * payments, без отгрузок, без возвратов и без остатка после каждой строки. На
 * вопрос «за что двенадцать миллионов?» ответить было можно только повторив
 * сумму.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Главное здесь — СХОДИМОСТЬ. Акт считает долг вторым, независимым путём: по
 * движениям, а не по формуле recalcShopDebt. Два способа посчитать одно и то
 * же — это ровно тот случай, когда они однажды разойдутся; поэтому расхождение
 * не прячется, а выносится в отдельное поле, и проверка следит, что на обычных
 * данных оно равно нулю.
 *
 * Плюс правила отбора движений, каждое из которых уже стоило денег в
 * recalcShopDebt и повторено здесь дословно.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../queries/connection";
import { shopStatement } from "../services/shop-statement";

const d = (iso: string) => new Date(iso);

interface Fixture {
  shop?: { id: number; name: string; ownerName: null; phone: null; address: null; debt: string } | null;
  orders?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  returns?: Array<Record<string, unknown>>;
  /** Заказы, которые вернёт поиск «живых» и «ещё должных» по списку id. */
  liveOrderIds?: number[];
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
  const db: Record<string, unknown> = {
    select: vi.fn((cols?: Record<string, unknown>) => {
      const keys = Object.keys(cols ?? {});
      if (keys.includes("debt") && keys.includes("name")) shape = "shop";
      else if (keys.includes("paymentMethod")) shape = "orders";
      else if (keys.includes("type")) shape = "payments";
      else if (keys.includes("number") && keys.includes("amount")) shape = "returns";
      else shape = "ids";
      return db;
    }),
    from: vi.fn(() => db),
    limit: vi.fn(() => (f.shop === null ? [] : [f.shop])),
    where: vi.fn(() => {
      switch (shape) {
        case "shop":     return db;
        case "orders":   return f.orders ?? [];
        case "payments": return f.payments ?? [];
        case "returns":  return f.returns ?? [];
        // Оба поиска по списку id отдают одно и то же поле; какой именно
        // спрашивают, видно по тому, вызывался ли он первым.
        default: {
          const ids = idsQueue.shift() ?? [];
          return ids.map(id => ({ id }));
        }
      }
    }),
  };
  const idsQueue: number[][] = [f.liveOrderIds ?? [], f.owedOrderIds ?? []];
  return db;
}

const SHOP = { id: 1, name: "Mega Do'kon", ownerName: null, phone: null, address: null, debt: "0.00" };

describe("акт сверки сходится с числом долга", () => {
  beforeEach(() => vi.clearAllMocks());

  it("отгрузка плюс, оплата минус, остаток нарастает построчно", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      shop: { ...SHOP, debt: "70000.00" },
      orders: [
        { createdAt: d("2026-01-10"), deliveredAt: null, paymentMethod: "debt", number: "З-1", total: "100000.00" },
      ],
      payments: [
        { createdAt: d("2026-01-15"), type: "payment", amount: "30000.00", notes: "наличными", orderId: null },
      ],
    }) as never);

    const st = await shopStatement(1, 1);

    expect(st).not.toBeNull();
    expect(st!.rows).toHaveLength(2);
    expect(st!.rows[0]).toMatchObject({ kind: "order", debit: 100000, credit: 0, balance: 100000 });
    expect(st!.rows[1]).toMatchObject({ kind: "payment", debit: 0, credit: 30000, balance: 70000 });
    expect(st!.closing).toBe(70000);
    // То, ради чего всё: бумага и карточка называют одно число.
    expect(st!.discrepancy, "акт разошёлся с shops.debt").toBe(0);
  });

  it("движения идут по дате, а не по тому, из какой таблицы пришли", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      shop: { ...SHOP, debt: "50000.00" },
      orders: [
        { createdAt: d("2026-02-01"), deliveredAt: null, paymentMethod: "debt", number: "З-1", total: "40000.00" },
        { createdAt: d("2026-03-01"), deliveredAt: null, paymentMethod: "debt", number: "З-2", total: "30000.00" },
      ],
      payments: [
        { createdAt: d("2026-02-10"), type: "payment", amount: "20000.00", notes: null, orderId: null },
      ],
    }) as never);

    const st = await shopStatement(1, 1);

    expect(st!.rows.map(r => r.doc ?? r.kind)).toEqual(["З-1", "payment", "З-2"]);
    expect(st!.rows.map(r => r.balance)).toEqual([40000, 20000, 50000]);
  });

  it("обычный заказ становится долгом с отгрузки, а не с оформления", async () => {
    /*
      До отгрузки магазин ничего не должен, что бы ни стояло в заказе. У заказа
      в долг — наоборот: он должен с того дня, как выписан.
    */
    vi.mocked(getDb).mockReturnValue(fakeDb({
      shop: { ...SHOP, debt: "40000.00" },
      orders: [
        { createdAt: d("2026-01-01"), deliveredAt: d("2026-01-20"), paymentMethod: "cash", number: "З-9", total: "40000.00" },
      ],
    }) as never);

    const st = await shopStatement(1, 1);

    expect(st!.rows[0].date).toEqual(d("2026-01-20"));
  });

  it("платёж по удалённому заказу не засчитывается", async () => {
    /*
      Удаление заказа — штатный способ исправить ошибку ВВОДА: заказа не было
      вовсе, значит не было и оплаты по нему. Засчитать её значило бы выдать
      магазину придуманный кредит. Так же поступает recalcShopDebt.
    */
    vi.mocked(getDb).mockReturnValue(fakeDb({
      shop: { ...SHOP, debt: "0.00" },
      payments: [
        { createdAt: d("2026-01-15"), type: "payment", amount: "30000.00", notes: null, orderId: 55 },
      ],
      liveOrderIds: [],   // заказ 55 удалён
    }) as never);

    const st = await shopStatement(1, 1);

    expect(st!.rows).toHaveLength(0);
    expect(st!.closing).toBe(0);
  });

  it("возврат по заказу, который уже ничего не должен, не вычитается дважды", async () => {
    /*
      Отменённый заказ и так даёт ноль; вычесть сверх этого возврат значило бы
      списать те же деньги второй раз — и у магазина с другими открытыми
      заказами излишек съел бы чужой долг.
    */
    vi.mocked(getDb).mockReturnValue(fakeDb({
      shop: { ...SHOP, debt: "0.00" },
      returns: [
        { createdAt: d("2026-02-01"), number: "В-1", amount: "25000.00", notes: null, orderId: 77 },
      ],
      owedOrderIds: [],   // заказ 77 отменён — обязательства по нему нет
    }) as never);

    const st = await shopStatement(1, 1);

    expect(st!.rows).toHaveLength(0);
  });

  it("ручное начисление считается только без привязки к заказу", async () => {
    // С заказом обязательство уже учтено самим заказом — иначе оно удвоится.
    vi.mocked(getDb).mockReturnValue(fakeDb({
      shop: { ...SHOP, debt: "5000.00" },
      payments: [
        { createdAt: d("2026-01-05"), type: "debt", amount: "5000.00", notes: "по тетради", orderId: null },
        { createdAt: d("2026-01-06"), type: "debt", amount: "9999.00", notes: null, orderId: 3 },
      ],
      liveOrderIds: [3],
    }) as never);

    const st = await shopStatement(1, 1);

    expect(st!.rows).toHaveLength(1);
    expect(st!.rows[0]).toMatchObject({ kind: "debt", debit: 5000, note: "по тетради" });
  });

  it("переплата показывается расхождением, а не прячется", async () => {
    /*
      recalcShopDebt дважды ставит нижнюю границу по нулю, поэтому долг равен
      нулю, а движения дают минус. Разница видна отдельно: ноль в ней означает
      «бумага сходится», не ноль — переплата или повод разбираться.
    */
    vi.mocked(getDb).mockReturnValue(fakeDb({
      shop: { ...SHOP, debt: "0.00" },
      orders: [
        { createdAt: d("2026-01-10"), deliveredAt: null, paymentMethod: "debt", number: "З-1", total: "10000.00" },
      ],
      payments: [
        { createdAt: d("2026-01-15"), type: "payment", amount: "15000.00", notes: null, orderId: null },
      ],
    }) as never);

    const st = await shopStatement(1, 1);

    expect(st!.closing).toBe(-5000);
    expect(st!.debtNow).toBe(0);
    expect(st!.discrepancy).toBe(5000);
  });

  it("период отрезает движения, а начальный остаток их помнит", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({
      shop: { ...SHOP, debt: "70000.00" },
      orders: [
        { createdAt: d("2026-01-10"), deliveredAt: null, paymentMethod: "debt", number: "СТАРЫЙ", total: "100000.00" },
        { createdAt: d("2026-03-10"), deliveredAt: null, paymentMethod: "debt", number: "НОВЫЙ", total: "20000.00" },
      ],
      payments: [
        { createdAt: d("2026-01-15"), type: "payment", amount: "30000.00", notes: null, orderId: null },
      ],
    }) as never);

    const st = await shopStatement(1, 1, d("2026-02-01"), d("2026-04-01"));

    // Входящий остаток — всё, что случилось до периода: 100000 − 30000.
    expect(st!.opening).toBe(70000);
    expect(st!.rows.map(r => r.doc)).toEqual(["НОВЫЙ"]);
    expect(st!.closing).toBe(90000);
    // Период закрыт справа — сверять его остаток с сегодняшним долгом незачем.
    expect(st!.discrepancy).toBe(0);
  });

  it("несуществующая точка не выдумывает акт", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({ shop: null }) as never);
    await expect(shopStatement(1, 999)).resolves.toBeNull();
  });
});
