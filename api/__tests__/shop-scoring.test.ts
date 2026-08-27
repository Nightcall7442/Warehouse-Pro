import { describe, it, expect } from "vitest";
import { classify } from "../services/shop-scoring";

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
