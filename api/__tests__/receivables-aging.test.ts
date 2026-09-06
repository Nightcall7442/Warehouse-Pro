/**
 * Долг магазинов состарен, и части сходятся с итогом.
 *
 * ── Зачем это вообще ────────────────────────────────────────────────────────
 *
 * Наш долг перед поставщиком система знала подробно — у поставки есть срок
 * оплаты и считается просрочка. А долг магазинов нам хранился одним числом:
 * «двенадцать миллионов». Недельные двенадцать миллионов и полугодовые — это
 * две разные организации, и решение (кому звонить, кому перестать отгружать в
 * долг) принимается именно из этого различия.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Главное здесь — не корзины сами по себе, а СХОДИМОСТЬ. Долг магазина
 * складывается не только из заказов: есть ручные начисления без заказа и
 * возвраты, у которых своей даты обязательства нет. Состарить их нельзя, и
 * замолчать разницу нельзя тоже — отчёт, части которого не дают итог, хуже
 * отсутствующего. Разница выделена отдельной величиной, и тесты держат
 * равенство «корзины + неотнесённое = долг».
 */
import { describe, it, expect } from "vitest";
import { rollUp, AGE_BUCKETS } from "../services/receivables";

const row = (over: Partial<Parameters<typeof rollUp>[0][number]>) => ({
  shopId: 1,
  shopName: "Магазин у дома",
  debt: 0,
  bucket: null,
  amount: null,
  oldestDays: null,
  ...over,
});

const sumBuckets = (b: Record<string, number>) =>
  AGE_BUCKETS.reduce((s, k) => s + b[k], 0);

describe("раскладка по возрасту", () => {
  it("заказы одного магазина ложатся в свои корзины", () => {
    const out = rollUp([
      row({ debt: 300, bucket: "d0_7", amount: 100, oldestDays: 3 }),
      row({ debt: 300, bucket: "d31_60", amount: 200, oldestDays: 45 }),
    ]);

    expect(out.buckets.d0_7).toBe(100);
    expect(out.buckets.d31_60).toBe(200);
    expect(out.buckets.d8_30).toBe(0);
  });

  it("возраст самого старого долга — наибольший из его заказов", () => {
    const out = rollUp([
      row({ debt: 300, bucket: "d0_7", amount: 100, oldestDays: 3 }),
      row({ debt: 300, bucket: "d31_60", amount: 200, oldestDays: 45 }),
    ]);
    expect(out.shops[0].oldestDays).toBe(45);
  });

  it("магазин без неоплаченных заказов не выдумывает возраст", () => {
    const out = rollUp([row({ debt: 500 })]);
    expect(out.shops[0].oldestDays).toBeNull();
  });
});

describe("части сходятся с итогом", () => {
  it("корзины плюс неотнесённое дают долг магазина", () => {
    // 300 из заказов, 200 — ручное начисление без заказа.
    const out = rollUp([
      row({ debt: 500, bucket: "d8_30", amount: 300, oldestDays: 20 }),
    ]);

    const shop = out.shops[0];
    expect(sumBuckets(shop.buckets) + shop.unattributed).toBe(shop.debt);
    expect(shop.unattributed).toBe(200);
  });

  it("возврат делает неотнесённое отрицательным, и это верно", () => {
    /*
      Возврат уменьшает долг магазина целиком, а заказ, по которому он
      оформлен, продолжает висеть в своей корзине. Минус в строке «не
      привязано к заказу» — не ошибка, а ровно то, на что она указывает:
      долг закрыт не оплатой заказа.
    */
    const out = rollUp([
      row({ debt: 100, bucket: "d8_30", amount: 400, oldestDays: 15 }),
    ]);

    const shop = out.shops[0];
    expect(shop.unattributed).toBe(-300);
    expect(sumBuckets(shop.buckets) + shop.unattributed).toBe(shop.debt);
  });

  it("итог по всем магазинам тоже сходится", () => {
    const out = rollUp([
      row({ shopId: 1, shopName: "Первый", debt: 500, bucket: "d8_30", amount: 300, oldestDays: 20 }),
      row({ shopId: 2, shopName: "Второй", debt: 200, bucket: "d0_7", amount: 200, oldestDays: 2 }),
    ]);

    expect(out.totalDebt).toBe(700);
    expect(sumBuckets(out.buckets) + out.unattributed).toBe(out.totalDebt);
  });
});

describe("порядок и счёт должников", () => {
  it("первым идёт тот, кто должен больше", () => {
    const out = rollUp([
      row({ shopId: 1, shopName: "Мелкий", debt: 100 }),
      row({ shopId: 2, shopName: "Крупный", debt: 900 }),
    ]);
    expect(out.shops.map(s => s.shopName)).toEqual(["Крупный", "Мелкий"]);
  });

  it("магазин с нулевым долгом должником не считается", () => {
    // В выборку он попадает, если по нему есть открытый заказ, но в счёт
    // должников — нет: долга за ним не числится.
    const out = rollUp([
      row({ shopId: 1, debt: 0 }),
      row({ shopId: 2, debt: 250 }),
    ]);
    expect(out.debtorCount).toBe(1);
  });

  it("пустой ответ — нули, а не поломка", () => {
    const out = rollUp([]);
    expect(out.totalDebt).toBe(0);
    expect(out.debtorCount).toBe(0);
    expect(out.shops).toEqual([]);
    expect(sumBuckets(out.buckets)).toBe(0);
  });
});

describe("числа приходят из базы строками", () => {
  it("строковые суммы складываются, а не склеиваются", () => {
    // MySQL отдаёт DECIMAL строкой: «300» + «200» дало бы «300200».
    const out = rollUp([
      row({ debt: "500", bucket: "d8_30", amount: "300", oldestDays: "20" }),
    ]);
    expect(out.buckets.d8_30).toBe(300);
    expect(out.totalDebt).toBe(500);
    expect(out.shops[0].oldestDays).toBe(20);
  });
});
