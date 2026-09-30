import { describe, it, expect } from "vitest";
import { claimVerdict, onHandsOf } from "../services/order-close";
import { tiyin } from "../services/order-shared";

/**
 * «Принять по заявленному»: правило, по которому заказ закрывается пачкой.
 *
 * Что было: вечером оператор открывал каждый доставленный заказ и жал
 * «Закрыть расчёт» — обычно с заявленным курьером, равным остатку. Пачки не
 * было, правила «когда можно не глядя» — тоже.
 *
 * Что проверяется — чистое правило claimVerdict (services/order-close.ts):
 *   · заявленное = остаток к оплате до тийина → закрывается;
 *   · на тийин меньше или больше → «заявлено ≠ остаток» (иначе вышла бы
 *     недостача, излишек или долг — это решает человек по одному заказу);
 *   · заявленное + карта курьера ровно на итог → закрывается (остаток к
 *     оплате без заявленного — это итог минус безнал);
 *   · уже закрыт, не доставлен, нет заявленного — свои причины, и «уже
 *     закрыт» главнее прочих;
 *   · тийины — целые: 0.1 + 0.2 не превращается в 0.30000000000000004.
 *   · сторнированный полевой платёж — не «на руках».
 *
 * Нарочная поломка: сравнение через round2 вместо целых тийинов при допуске
 * 0.01 (Math.abs(...) <= 1) — падает «на тийин меньше»; убрать проверку
 * closed первой — падает «уже закрыт главнее».
 */
const T = (n: number) => tiyin(n);
const v = (o: Partial<{ status: string; closed: boolean; total: number; paid: number; claimed: number }>) => claimVerdict({
  status: o.status ?? "delivered", closed: o.closed ?? false, totalT: T(o.total ?? 300), paidT: T(o.paid ?? 300), claimedT: T(o.claimed ?? 300),
});

describe("claimVerdict: когда заказ закрывается «по заявленному»", () => {
  it("заявлено = остаток → закрывается", () => {
    expect(v({})).toBeNull();
    expect(v({ total: 1_234_567.89, paid: 1_234_567.89, claimed: 1_234_567.89 })).toBeNull();
  });
  it("на тийин меньше или больше — «заявлено ≠ остаток»", () => {
    expect(v({ total: 300, paid: 299.99, claimed: 299.99 })).toBe("mismatch");
    expect(v({ total: 300, paid: 300.01, claimed: 300.01 })).toBe("mismatch");
  });
  it("часть картой у курьера, наличные — ровно на остальное → закрывается", () => {
    expect(v({ total: 250.5, paid: 250.5, claimed: 150.5 })).toBeNull();
    expect(v({ total: 250.5, paid: 250.49, claimed: 150.49 })).toBe("mismatch");
  });
  it("уже закрыт главнее прочих; не доставлен; нет заявленного", () => {
    expect(v({ closed: true, status: "returned", claimed: 0 })).toBe("closed");
    expect(v({ status: "shipped" })).toBe("not_delivered");
    expect(v({ claimed: 0, paid: 300 })).toBe("no_claim");
    expect(v({ claimed: 0, paid: 0 })).toBe("no_claim");
  });
  it("тийины целые: 0.1 + 0.2 сходится с 0.3", () => {
    const claimedT = T(0.1) + T(0.2);
    expect(claimVerdict({ status: "delivered", closed: false, totalT: T(0.3), paidT: claimedT, claimedT })).toBeNull();
  });
  it("сторнированный полевой платёж — не на руках", () => {
    const rows = [
      { id: 1, type: "payment", reversalOf: null, method: "cash", receivedAt: null },
      { id: 2, type: "payment", reversalOf: 1, method: "cash", receivedAt: null },
      { id: 3, type: "payment", reversalOf: null, method: "cash", receivedAt: null },
      { id: 4, type: "payment", reversalOf: null, method: "card", receivedAt: null },
    ] as Parameters<typeof onHandsOf>[0];
    expect(onHandsOf(rows).map(r => r.id)).toEqual([3]);
  });
});
