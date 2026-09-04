import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Прогноз исчерпания запасов и подсказка «что дозаказать».
 *
 * ── Чем это опасно ───────────────────────────────────────────────────────────
 *
 * Ошибка здесь не роняет ничего и ничего не красит красным — она просто
 * называет неверное число. Завышенное среднедневное потребление гонит закупать
 * лишнее и морозит деньги в складе; заниженное оставляет полку пустой. Обе
 * беды обнаруживаются через недели, и обе выглядят как «ну, прогноз же».
 *
 * Поэтому проверяется арифметика по шагам: как считается среднее, что входит
 * в «доступный остаток», где проходят границы срочности и в каком порядке
 * выдаётся список.
 */

vi.mock("../lib/cache", () => ({
  // Кэш живёт две минуты и между проверками мешал бы: второй вызов с теми же
  // доводами возвращал бы ответ первого.
  withCache: (_key: string, _ttl: number, produce: () => Promise<unknown>) => produce(),
  CacheKeys: {},
}));

vi.mock("drizzle-orm", () => ({
  eq:      (col: unknown, val: unknown) => ({ __kind: "eq", col, val }),
  and:     (...conds: unknown[]) => ({ __kind: "and", conds }),
  inArray: (col: unknown, vals: unknown) => ({ __kind: "inArray", col, vals }),
  gte:     (col: unknown, val: unknown) => ({ __kind: "gte", col, val }),
  lt:      (col: unknown, val: unknown) => ({ __kind: "lt", col, val }),
  isNull:  (col: unknown) => ({ __kind: "isNull", col }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __kind: "sql", strings, values }),
    { join: (c: unknown[]) => ({ __kind: "sql_join", c }), raw: (s: string) => ({ __kind: "sql_raw", s }) },
  ),
}));

const { warehouseStock, orderItems, arrivalItems, orders } = await import("@db/schema");

/** Строки, которые отдаёт поддельная база, и условия, которые она получила. */
interface Canned {
  stock: Array<Record<string, unknown>>;
  demand: Array<Record<string, unknown>>;
  pending: Array<Record<string, unknown>>;
}
let canned: Canned;
/** Условия WHERE каждой выборки — по имени таблицы-источника. */
let capturedWhere: Record<string, unknown>;

function makeDb() {
  return {
    select: () => {
      let source = "other";
      const api: any = {
        from: (ref: unknown) => {
          source = ref === warehouseStock ? "stock"
            : ref === orderItems ? "demand"
            : ref === arrivalItems ? "pending" : "other";
          return api;
        },
        innerJoin: () => api,
        where: (cond: unknown) => {
          capturedWhere[source] = cond;
          const rows = source === "stock" ? canned.stock
            : source === "demand" ? canned.demand
            : source === "pending" ? canned.pending : [];
          const p: any = Promise.resolve(rows);
          p.groupBy = () => {
            const q: any = Promise.resolve(rows);
            q.orderBy = () => Promise.resolve(rows);
            return q;
          };
          return p;
        },
      };
      return api;
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

const { avgDailyConsumption, predictStockouts, getReorderRecommendations } =
  await import("../services/stock-predictor");

/** Все условия набора — развёрнутые из вложенных and(). */
function flatten(cond: unknown): any[] {
  const out: any[] = [];
  const walk = (c: any) => {
    if (!c || typeof c !== "object") return;
    if (c.__kind === "and") { (c.conds ?? []).forEach(walk); return; }
    out.push(c);
  };
  walk(cond);
  return out;
}

const stockRow = (over: Record<string, unknown> = {}) => ({
  productId: 1, productName: "Печенье", productCode: "P-1",
  currentStock: "100.000", reorderPoint: "20.00", ...over,
});

beforeEach(() => {
  canned = { stock: [], demand: [], pending: [] };
  capturedWhere = {};
  mockDb = makeDb();
});

describe("среднедневное потребление", () => {
  it("пустой ряд даёт ноль, а не деление на ноль", () => {
    expect(avgDailyConsumption([])).toBe(0);
  });

  it("делится на длину ряда, включая дни без продаж", () => {
    // Дни с нулём обязаны попадать в делитель: товар, проданный один раз за
    // месяц, иначе выглядел бы уходящим каждый день.
    const demand = [{ date: "1", quantity: 30 }, { date: "2", quantity: 0 }, { date: "3", quantity: 0 }];
    expect(avgDailyConsumption(demand as never)).toBe(10);
  });

  it("округляется до сотых", () => {
    const demand = [{ date: "1", quantity: 1 }, { date: "2", quantity: 1 }, { date: "3", quantity: 0 }];
    expect(avgDailyConsumption(demand as never)).toBe(0.67);
  });
});

describe("прогноз исчерпания: арифметика", () => {
  it("среднее делится на длину окна, а не на число дней с продажами", () => {
    // 300 штук за 30 дней — 10 в день, даже если продали их за один день.
    canned.stock = [stockRow({ currentStock: "100.000" })];
    canned.demand = [{ productId: 1, quantity: "300.000" }];

    return predictStockouts(1, 30).then(([p]) => {
      expect(p.avgDailyConsumption).toBe(10);
      expect(p.daysUntilStockout).toBe(10);
    });
  });

  it("ожидаемый приход прибавляется к остатку", () => {
    // Машина в пути — товар фактически есть, и торопить закупку незачем.
    canned.stock = [stockRow({ currentStock: "100.000" })];
    canned.demand = [{ productId: 1, quantity: "300.000" }];
    canned.pending = [{ productId: 1, total: "200.000" }];

    return predictStockouts(1, 30).then(([p]) => {
      expect(p.pendingArrivals).toBe(200);
      // (100 + 200) / 10 = 30 дней вместо десяти.
      expect(p.daysUntilStockout).toBe(30);
    });
  });

  it("без продаж срок не считается и товар не срочный", () => {
    canned.stock = [stockRow({ currentStock: "5.000" })];
    return predictStockouts(1, 30).then(([p]) => {
      expect(p.avgDailyConsumption).toBe(0);
      expect(p.daysUntilStockout).toBe(999);
      expect(p.urgency).toBe("ok");
    });
  });

  it("дозаказ нужен, когда остаток С УЧЁТОМ прихода не выше точки заказа", () => {
    canned.stock = [stockRow({ currentStock: "10.000", reorderPoint: "20.00" })];
    canned.pending = [{ productId: 1, total: "10.000" }];
    // 10 + 10 = 20, точка заказа 20 — ровно на границе, дозаказ нужен.
    return predictStockouts(1, 30).then(([p]) => expect(p.needsReorder).toBe(true));
  });

  it("остаток выше точки заказа дозаказа не требует", () => {
    canned.stock = [stockRow({ currentStock: "21.000", reorderPoint: "20.00" })];
    return predictStockouts(1, 30).then(([p]) => expect(p.needsReorder).toBe(false));
  });
});

describe("прогноз исчерпания: границы срочности", () => {
  const withDays = async (stock: string, demandQty: string) => {
    canned.stock = [stockRow({ currentStock: stock })];
    canned.demand = [{ productId: 1, quantity: demandQty }];
    const [p] = await predictStockouts(1, 30);
    return p;
  };

  it("три дня — уже критично", async () => {
    // 30 в день, остаток 90 → ровно 3 дня.
    expect((await withDays("90.000", "900.000")).urgency).toBe("critical");
  });

  it("четыре дня — предупреждение", async () => {
    expect((await withDays("120.000", "900.000")).urgency).toBe("warning");
  });

  it("семь дней — ещё предупреждение", async () => {
    expect((await withDays("210.000", "900.000")).urgency).toBe("warning");
  });

  it("восемь дней — уже спокойно", async () => {
    expect((await withDays("240.000", "900.000")).urgency).toBe("ok");
  });
});

describe("прогноз исчерпания: порядок выдачи", () => {
  it("критичные впереди, внутри срочности — по близости срока", () => {
    // Список читают сверху вниз и до конца доходят редко. Порядок здесь —
    // это и есть приоритет закупки.
    canned.stock = [
      stockRow({ productId: 1, productName: "Спокойный",  currentStock: "900.000" }),
      stockRow({ productId: 2, productName: "Критичный-2", currentStock: "60.000" }),
      stockRow({ productId: 3, productName: "Тревожный",  currentStock: "150.000" }),
      stockRow({ productId: 4, productName: "Критичный-1", currentStock: "30.000" }),
    ];
    canned.demand = [1, 2, 3, 4].map(productId => ({ productId, quantity: "900.000" }));

    return predictStockouts(1, 30).then(list => {
      expect(list.map(p => p.productName)).toEqual([
        "Критичный-1", "Критичный-2", "Тревожный", "Спокойный",
      ]);
    });
  });
});

describe("подсказка «что дозаказать»", () => {
  it("в список попадают только требующие внимания", () => {
    canned.stock = [
      stockRow({ productId: 1, productName: "Спокойный", currentStock: "900.000" }),
      stockRow({ productId: 2, productName: "Кончается", currentStock: "30.000" }),
    ];
    canned.demand = [1, 2].map(productId => ({ productId, quantity: "900.000" }));

    return getReorderRecommendations(1, 30).then(list => {
      expect(list.map(r => r.productName)).toEqual(["Кончается"]);
    });
  });

  it("количество покрывает срок поставки плюс две недели запаса", () => {
    canned.stock = [stockRow({ currentStock: "30.000", reorderPoint: "0.00" })];
    canned.demand = [{ productId: 1, quantity: "300.000" }];

    return getReorderRecommendations(1, 30, 3).then(([r]) => {
      // 10 в день × (3 дня доставки + 14 дней запаса) = 170.
      expect(r.suggestedQuantity).toBe(170);
    });
  });

  it("количество не меньше того, чего не хватает до точки заказа", () => {
    // Товар почти не продаётся, но точка заказа высокая: закупить надо
    // столько, чтобы до неё дотянуть, а не «ноль, потому что не продаётся».
    canned.stock = [stockRow({ currentStock: "5.000", reorderPoint: "100.00" })];

    return getReorderRecommendations(1, 30, 3).then(([r]) => {
      expect(r.suggestedQuantity).toBe(95);
    });
  });
});

describe("прогноз исчерпания: удалённые заказы", () => {
  it("не участвуют в расчёте спроса", () => {
    // Удалённый заказ — это отменённая продажа. Считать по нему спрос значит
    // завысить среднедневное потребление и гнать закупать лишнее.
    //
    // В проекте для этого есть revenueOrderConditions (api/lib/order-status.ts),
    // и заведён он ровно потому, что при ручном переписывании условий фильтр
    // удалённых терялся — по его же комментарию, в четырёх местах из шести.
    // Здесь условия тоже написаны руками.
    canned.stock = [stockRow()];
    canned.demand = [{ productId: 1, quantity: "300.000" }];

    return predictStockouts(1, 30).then(() => {
      const conds = flatten(capturedWhere.demand);
      const hasDeletedFilter = conds.some(
        c => c.__kind === "isNull" && c.col === orders.deletedAt,
      );
      expect(hasDeletedFilter, "в условиях выборки спроса нет isNull(orders.deletedAt)").toBe(true);
    });
  });
});
