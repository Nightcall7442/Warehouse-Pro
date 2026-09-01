import { describe, it, expect } from "vitest";
import { classify, shopScores } from "../services/shop-scoring";

/**
 * Цвет магазина на карте.
 *
 * Правило видит супервайзер и сверяет с тем, что и так знает про свои точки.
 * Поэтому проверяется не «функция что-то вернула», а каждая граница по
 * отдельности: ошибка здесь не падает, а тихо красит в неверный цвет, и
 * заметят её через месяц, когда по красному магазину поедет машина, а по
 * зелёному — нет.
 */

const base = { debt: 0, orderCount: 10, debtShare: 0, oldestUnpaidDays: 0 };

describe("новый магазин", () => {
  it("серый — только когда заказов не было вовсе", () => {
    expect(classify({ ...base, orderCount: 0 }).tier).toBe("new");
  });

  it("долг судится с первого заказа, а не с третьего", () => {
    // Проверено на живых данных: у организации с 983 заказами почти у всех
    // точек один-два заказа. Порог «трёх заказов на любой приговор» красил
    // 446 магазинов из 500 в серый — карта не показывала ничего.
    expect(classify({ ...base, orderCount: 1, debt: 5_000_000, oldestUnpaidDays: 90 }).tier).toBe("red");
    expect(classify({ ...base, orderCount: 2, debt: 900_000, oldestUnpaidDays: 5 }).tier).toBe("yellow");
    expect(classify({ ...base, orderCount: 1 }).tier).toBe("green");
  });

  it("а вот привычка брать в долг — только при нескольких заказах", () => {
    // Доля 100% на одном заказе ничего не говорит о повторяемости.
    expect(classify({ ...base, orderCount: 1, debtShare: 1, debt: 900_000, oldestUnpaidDays: 14 }).tier).toBe("yellow");
    expect(classify({ ...base, orderCount: 3, debtShare: 1, debt: 900_000, oldestUnpaidDays: 14 }).tier).toBe("red");
  });
});

describe("красный — держит наши деньги", () => {
  it("долг и самому старому заказу месяц", () => {
    const r = classify({ ...base, debt: 4_800_000, oldestUnpaidDays: 30 });
    expect(r.tier).toBe("red");
    expect(r.reason).toContain("30");
  });

  it("на день раньше месяца — ещё жёлтый", () => {
    expect(classify({ ...base, debt: 4_800_000, oldestUnpaidDays: 29 }).tier).toBe("yellow");
  });

  it("берёт в долг почти всё и не платит две недели", () => {
    // Отдельная, более строгая граница: магазин, который берёт в долг
    // постоянно, опаснее того, кто разово задержал оплату.
    const r = classify({ ...base, debt: 900_000, debtShare: 0.7, oldestUnpaidDays: 14 });
    expect(r.tier).toBe("red");
    expect(r.reason).toContain("70%");
  });

  it("но если в долг берёт редко — те же две недели ещё жёлтые", () => {
    expect(classify({ ...base, debt: 900_000, debtShare: 0.69, oldestUnpaidDays: 14 }).tier).toBe("yellow");
  });
});

describe("зелёный — рассчитывается", () => {
  it("открытых долгов нет", () => {
    expect(classify({ ...base, debt: 0 }).tier).toBe("green");
  });

  it("берёт в долг, но гасит — всё равно зелёный, и это сказано в подсказке", () => {
    // Важный случай: «покупает в долг» само по себе не порок, если платит.
    const r = classify({ ...base, debt: 0, debtShare: 0.9 });
    expect(r.tier).toBe("green");
    expect(r.reason).toContain("рассчитывается");
  });

  it("долг есть — зелёным уже не будет, каким бы свежим он ни был", () => {
    expect(classify({ ...base, debt: 1, oldestUnpaidDays: 0 }).tier).toBe("yellow");
  });
});

describe("подсказка объясняет цвет цифрами", () => {
  it("в красном названы и сумма, и срок", () => {
    const r = classify({ ...base, debt: 12_345_678, oldestUnpaidDays: 47 });
    expect(r.reason).toContain("47");
    expect(r.reason).toMatch(/12\s?345\s?678/);
  });

  it("у магазина без заказов сказано именно это", () => {
    expect(classify({ ...base, orderCount: 0 }).reason).toContain("не было");
  });
});

/**
 * Сборка строки из ответа базы.
 *
 * Границы classify выше проверены поштучно, но между запросом и цветом есть
 * ещё один слой: приведение типов и три производных числа. Он не покрывался
 * ничем, а ошибиться в нём легко — все значения приезжают из MySQL строками.
 */
describe("сборка строки магазина из ответа базы", () => {
  /** Поддельная база: отдаёт ровно то, что вернул бы запрос. */
  function dbWith(rows: Array<Record<string, unknown>>) {
    // mysql2 отвечает парой [строки, метаданные] — сервис разбирает именно её.
    return { execute: () => Promise.resolve([rows, []]) } as unknown as Parameters<typeof shopScores>[0];
  }

  const row = (over: Record<string, unknown> = {}) => ({
    shop_id: "1", name: "Альфа", lat: "41.30000000", lng: "69.20000000",
    debt: "0.00", revenue: "0.00", returned: "0.00",
    order_count: "0", debt_orders: "0", oldest_unpaid_days: "0",
    last_order_at: null,
    ...over,
  });

  it("доля долговых заказов считается от их числа, а не берётся из базы", async () => {
    const [s] = await shopScores(dbWith([row({
      order_count: "10", debt_orders: "7", debt: "50000.00", oldest_unpaid_days: "20",
    })]), 1);

    expect(s.debtShare).toBeCloseTo(0.7);
    // 7 из 10 в долг и 20 дней без оплаты — по правилу привычки это красный.
    expect(s.tier).toBe("red");
  });

  it("возврат больше выручки не превращается в отрицательное «принёс денег»", async () => {
    // Бывает у магазина, вернувшего заказ прошлого периода. Минус в этой
    // графе на карте не значит ничего и только сбивает.
    const [s] = await shopScores(dbWith([row({ revenue: "100000.00", returned: "300000.00", order_count: "3" })]), 1);
    expect(s.ltv).toBe(0);
  });

  it("выручка считается за вычетом возвратов", async () => {
    const [s] = await shopScores(dbWith([row({ revenue: "1000000.00", returned: "250000.00", order_count: "5" })]), 1);
    expect(s.ltv).toBe(750_000);
  });

  it("магазин без координат отдаёт null, а не ноль", async () => {
    // Ноль — это точка в Гвинейском заливе. Карта обязана такой магазин
    // пропустить, а не поставить метку в океане.
    const [s] = await shopScores(dbWith([row({ lat: null, lng: null })]), 1);
    expect(s.lat).toBeNull();
    expect(s.lng).toBeNull();
  });

  it("числа приходят числами, хотя база отдаёт их строками", async () => {
    const [s] = await shopScores(dbWith([row({ debt: "50000.00", order_count: "4", oldest_unpaid_days: "12" })]), 1);
    expect(s.debt).toBe(50_000);
    expect(s.orderCount).toBe(4);
    expect(s.oldestUnpaidDays).toBe(12);
    expect(typeof s.shopId).toBe("number");
  });

  it("у магазина без заказов доля долга ноль, а не деление на ноль", async () => {
    const [s] = await shopScores(dbWith([row()]), 1);
    expect(s.debtShare).toBe(0);
    expect(Number.isNaN(s.debtShare)).toBe(false);
    expect(s.tier).toBe("new");
  });

  it("пустая выборка даёт пустой список, а не падение", async () => {
    expect(await shopScores(dbWith([]), 1)).toEqual([]);
  });
});
