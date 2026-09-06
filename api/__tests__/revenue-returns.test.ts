/**
 * Возврат уменьшает прибыль ровно один раз.
 *
 * ── Чего не хватало ─────────────────────────────────────────────────────────
 *
 * Слова «возврат» в расчёте прибыли не было вовсе. Товар возвращался на склад,
 * долг магазина падал — обе стороны работали, — а выручка оставалась полной.
 * У организации с регулярными возвратами прибыль была завышена ровно на их
 * сумму, и расхождение нигде не проявлялось числом.
 *
 * ── Почему проверяется именно сложение ──────────────────────────────────────
 *
 * Сам запрос заглушки не исполняют, зато разбор его строк — чистые функции, и
 * ломается обычно как раз он: сложили выручку, забыли себестоимость; сложили
 * по месяцам, потеряли месяц без возвратов; отнесли возврат к месяцу продажи
 * вместо месяца проведения. Отбор строк (только проведённые, только по
 * доставленным заказам) проверяется на настоящей базе — real-db/.
 */
import { describe, it, expect } from "vitest";
import { totalReturned, groupReturned, NOTHING_RETURNED, type ReturnRow } from "../services/revenue-returns";

const row = (over: Partial<ReturnRow> = {}): ReturnRow => ({
  month: "2026-08",
  paymentMethod: "cash",
  agentId: 1,
  amount: 0,
  cost: 0,
  ...over,
});

describe("сложение возвратов", () => {
  it("складывает и выручку, и себестоимость", () => {
    /*
      Вычесть выручку, забыв себестоимость, — значит показать убыток там,
      где его нет: вернулось товара на 300, себестоимостью 180, прибыль
      падает на 120, а не на 300.
    */
    const out = totalReturned([
      row({ amount: 300, cost: 180 }),
      row({ amount: 200, cost: 110 }),
    ]);
    expect(out).toEqual({ amount: 500, cost: 290 });
  });

  it("пустой список — нули, а не поломка", () => {
    expect(totalReturned([])).toEqual(NOTHING_RETURNED);
  });

  it("общая величина не портится при повторном сложении", () => {
    // NOTHING_RETURNED раздаётся копией: попади он в накопитель по ссылке,
    // второй вызов начинал бы с итога первого.
    const first = totalReturned([row({ amount: 100, cost: 60 })]);
    const second = totalReturned([row({ amount: 5, cost: 3 })]);
    expect(first).toEqual({ amount: 100, cost: 60 });
    expect(second).toEqual({ amount: 5, cost: 3 });
  });
});

describe("разложение возвратов", () => {
  it("по месяцу проведения", () => {
    const out = groupReturned([
      row({ month: "2026-07", amount: 100, cost: 40 }),
      row({ month: "2026-08", amount: 300, cost: 180 }),
      row({ month: "2026-08", amount: 200, cost: 110 }),
    ], r => r.month);

    expect(out.get("2026-07")).toEqual({ amount: 100, cost: 40 });
    expect(out.get("2026-08")).toEqual({ amount: 500, cost: 290 });
  });

  it("месяц без возвратов в разложении отсутствует, а не обнуляется", () => {
    // График вычитает через `?? 0`: лишний ключ с нулём означал бы месяц,
    // которого в выборке не было.
    const out = groupReturned([row({ month: "2026-08", amount: 10 })], r => r.month);
    expect(out.has("2026-09")).toBe(false);
  });

  it("по способу оплаты заказа", () => {
    const out = groupReturned([
      row({ paymentMethod: "cash", amount: 100, cost: 60 }),
      row({ paymentMethod: "debt", amount: 250, cost: 150 }),
      row({ paymentMethod: "cash", amount: 50,  cost: 30 }),
    ], r => r.paymentMethod);

    expect(out.get("cash")).toEqual({ amount: 150, cost: 90 });
    expect(out.get("debt")).toEqual({ amount: 250, cost: 150 });
  });
});
