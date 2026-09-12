import { deriveShopDebt } from "./helpers/shop-debt-recalc";
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { orderSource } from "./helpers/order-source";

/**
 * `shops.debt` is derived, not maintained by hand — every mutation that can
 * change what a shop owes calls recalcShopDebt() and lets it re-read the
 * underlying orders, payments and returns. See api/services/shop-debt.ts for
 * why: the previous approach, where each call site nudged the balance by its
 * own delta, leaked real money out of the debtor list three separate times
 * (a delivery that booked nothing because the order wasn't marked "в долг";
 * a payment that subtracted from a balance nothing had ever been added to;
 * two helpers in one transaction where the second misread state the first had
 * just written).
 *
 * These tests guard that property at the source level, because the failure was
 * never a wrong formula — it was a *new code path that forgot the balance
 * existed*. A unit test of any single mutation cannot catch the next one of
 * those; a rule about the whole codebase can.
 */

const API_DIR = join(__dirname, "..");
const DEBT_HELPER = join("services", "shop-debt.ts");

function* walkTypeScript(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkTypeScript(full);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      yield full;
    }
  }
}

/** Statements that assign to the shops.debt column, in SQL or via the query builder. */
const DEBT_WRITE_PATTERNS = [
  /UPDATE\s+shops[\s\S]{0,80}?\bSET\b[\s\S]{0,40}?\bdebt\s*=/i, // raw SQL
  /\.set\(\s*\{[^}]*\bdebt\s*:/,                                 // drizzle .set({ debt: ... })
];

describe("shops.debt is written in exactly one place", () => {
  it("no module outside services/shop-debt.ts assigns to shops.debt", () => {
    const offenders: string[] = [];

    for (const file of walkTypeScript(API_DIR)) {
      const rel = relative(API_DIR, file);
      if (rel === DEBT_HELPER || rel === DEBT_HELPER.split(sep).join("/")) continue;

      const source = readFileSync(file, "utf8");
      if (DEBT_WRITE_PATTERNS.some(p => p.test(source))) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      offenders.length === 0 ? "" :
        `These modules assign to shops.debt directly:\n` +
        offenders.map(f => `  - ${f}`).join("\n") +
        `\n\nThe balance is derived, not maintained incrementally. Write the ` +
        `orders/payments/returns rows that justify the change, then call ` +
        `recalcShopDebt(tx, tenantId, shopId) — see services/shop-debt.ts.`,
    ).toEqual([]);
  });

  it("the helper's own statement is a full recompute, not a delta", () => {
    const helper = readFileSync(join(API_DIR, DEBT_HELPER), "utf8");

    // A delta update reads the column it writes ("debt = debt + x"); a
    // recompute never does. This is the property that makes the write
    // idempotent and safe to run twice in one transaction.
    expect(helper).not.toMatch(/\bdebt\s*=\s*[\s\S]{0,30}\bdebt\b\s*[+-]/i);
    expect(helper).toMatch(/SET\s+s\.debt\s*=\s*GREATEST\(0,/i);
  });
});

describe("every path that can change what a shop owes re-derives the balance", () => {
  /**
   * Writing an order/payment/return row is what *creates* an obligation; the
   * balance only reflects it once recalcShopDebt runs. A module that writes
   * those rows but never calls the helper has, by construction, left the
   * balance stale — which is exactly how the original bugs shipped.
   */
  const MUTATORS = [
    "services/order.ts",
    "services/payment.ts",
    "courier-router.ts",
    "returns-router.ts",
    "webhooks/onec.ts",
  ];

  it.each(MUTATORS)("%s calls recalcShopDebt", (relPath) => {
    // Служба заказа разнесена по файлам — читаем её одним куском.
    const source = relPath === "services/order.ts" ? orderSource() : readFileSync(join(API_DIR, relPath.split("/").join(sep)), "utf8");
    expect(source).toMatch(/recalcShopDebt\s*\(/);
  });
});

describe("the two return routes cannot credit the same goods twice", () => {
  /**
   * An order's goods can come back either by marking the order itself
   * cancelled/returned, or by completing a return document ("Возвраты")
   * against it. Both are supported. Applying both to the same order used to
   * double-count, in stock and in money:
   *
   *   order 10 units delivered → return document for 6 completed → order then
   *   marked returned
   *     stock:  240 → 246 → 256   (six units invented; 250 is correct)
   *     debt:   273 000 → 156 000 → 0   (the 78 000 owed on an *unrelated*
   *                                      order in the same shop wiped out)
   *
   * Those numbers are measured, not hypothetical — removing either guard
   * reproduces them exactly. The final GREATEST(0, …) hides the money half on
   * a shop whose only order this is, which is what let it go unnoticed.
   */

  it("возврат вычитается ровно при том же условии, при котором заказ начисляет", () => {
    const helper = readFileSync(join(API_DIR, DEBT_HELPER.split("/").join(sep)), "utf8");
    const returnsClause = helper.slice(helper.indexOf("FROM returns"));

    /*
      Проверка держит СМЫСЛ, а не форму записи.

      Стояло «NOT EXISTS … status IN ('cancelled','returned')» — то есть
      «вычитай, если заказ не списан». Этого мало: заказ перестаёт быть
      должным и другими способами. Его удаляют (deleted_at), или он выходит
      из 'delivered' обратно в работу — а не-долговой заказ в работе не должен
      ничего. В обоих случаях его вклад в начисление равен нулю, а возврат
      продолжал вычитаться: те же деньги списывались дважды.

      Поэтому требуется не конкретное написание, а совпадение с условием
      начисления: живой заказ, не отменённый и не возвращённый, и при этом
      либо долговой, либо уже доставленный. Разойдись эти два условия снова —
      падает здесь.
    */
    expect(returnsClause).toMatch(/o3\.deleted_at\s+IS\s+NULL/i);
    expect(returnsClause).toMatch(/status\s+NOT\s+IN\s*\(\s*'cancelled'\s*,\s*'returned'\s*\)/i);
    expect(returnsClause).toMatch(/payment_method\s*=\s*'debt'\s+OR\s+o3\.status\s*=\s*'delivered'/i);
  });

  it("оплата не исчезает вместе с заказом, который перестал быть должным", () => {
    const helper = readFileSync(join(API_DIR, DEBT_HELPER.split("/").join(sep)), "utf8");

    /*
      Платёж по заказу вычитается ИЗНУТРИ слагаемого этого заказа. Но заказ
      входит в сумму, только пока он должен: отменённый, возвращённый и просто
      ещё не доставленный не-долговой заказ дают ноль — и платёж по ним
      исчезал вместе с ними, как будто денег не приносили.

      Магазин внёс 100 из 300, заказ отменили: обязательство ушло правильно,
      а сотня растворилась. Заплатив, магазин получил право на эти деньги, и
      право не зависит от того, чем кончился заказ.

      Удалённые заказы в это слагаемое не входят намеренно: удаление — способ
      исправить ошибку ВВОДА, заказа не было вовсе, значит не было и оплаты.
    */
    const paidOnNonOwing = helper.slice(helper.indexOf("JOIN orders o2"));
    expect(paidOnNonOwing).not.toBe("");
    expect(paidOnNonOwing).toMatch(/o2\.deleted_at\s+IS\s+NULL/i);
    expect(paidOnNonOwing).toMatch(/NOT\s*\(/i);
  });

  it("updateStatus sizes its stock delta net of units already returned by document", () => {
    const source = orderSource();
    // Сколько единиц двигает смена статуса, решает heldQuantity: из доставленного
    // (или заказанного) вычитается уже возвращённое проведённым документом.
    // Раньше этот расчёт был вписан прямо в updateStatus, и проверка искала его
    // текст там же. Теперь он вынесен в общую функцию и применяется ещё и в
    // cancel/delete/restore — которые как раз и брали сырое quantity, — поэтому
    // проверяется сама функция, а не место, где её вызвали.
    expect(source).toMatch(/eq\(\s*returns\.status\s*,\s*"completed"\s*\)/);

    const held = source.slice(source.indexOf("function heldQuantity"));
    expect(held.slice(0, 600), "heldQuantity больше не вычитает возвращённое")
      .toMatch(/base\s*-\s*alreadyReturned/);
    expect(held.slice(0, 600), "heldQuantity больше не учитывает частичную доставку")
      .toMatch(/deliveredQuantity/);

    // Проверять наличие имён недостаточно: объявить cancelReturned и не
    // применить его в самом запросе — ровно та ошибка, которую надо ловить.
    // Поэтому смотрим на сами формулы освобождения резерва.
    const RAW_RELEASE = [
      "reserved - ${Number(i.quantity)}",
      "available + ${Number(i.quantity)}",
    ];
    for (const pattern of RAW_RELEASE) {
      expect(source, `освобождение резерва по сырому quantity: ${pattern} — вернётся больше, чем строка держит`)
        .not.toContain(pattern);
    }

    /*
      Каждое освобождение резерва считает величину через heldQuantity.

      Раньше здесь считалось ЧИСЛО вызовов (шесть: по два в cancel и delete,
      по одному в restore и updateStatus). Число было не свойством, а
      отпечатком тогдашнего кода: каждый запрос писал одно и то же выражение
      дважды — в присвоение available и в присвоение reserved. Как только
      освобождение переехало в общую дверь (releaseStock), величина стала
      браться ОДИН раз на место, и счётчик упал до пяти, ничего при этом не
      сломав.

      Считать копии — значит запрещать упрощение. Поэтому проверяется само
      свойство: у каждого вызова releaseStock количество приходит из
      heldQuantity, а не из сырого quantity.
    */
    const releases = [...source.matchAll(/releaseStock\(\s*tx\s*,\s*\{[\s\S]{0,400}?\}\s*\)/g)].map(m => m[0]);
    expect(releases.length, "освобождения резерва больше не идут через дверь").toBeGreaterThanOrEqual(3);

    /*
      Проверяются те освобождения, что идут ПО СТРОКАМ ЗАКАЗА (items.map) —
      отмена и удаление. Именно они брали сырое quantity и возвращали в
      свободный остаток больше, чем строка держит.

      Освобождение в applyStockDelta сюда не входит намеренно: там величину
      уже посчитал вызывающий и передал знаковой дельтой, строк заказа у этой
      функции нет вовсе.
    */
    const overLines = releases.filter(call => call.includes("items.map("));
    expect(overLines.length, "отмена и удаление больше не освобождают резерв по строкам").toBeGreaterThanOrEqual(2);
    for (const call of overLines) {
      expect(call, `освобождение резерва по строкам без heldQuantity:
${call}`).toContain("heldQuantity(");
    }
  });

  it("completing a return is refused when its order is already cancelled/returned", () => {
    const source = readFileSync(join(API_DIR, "returns-router.ts"), "utf8");
    // The reverse direction: the order already credited every unit back, so
    // the document must not run at all.
    expect(source).toMatch(/linkedOrder/);
    expect(source).toMatch(/уже.*(отменён|возвращён)|зачислило бы тот же товар/);
  });
});

/*
  Двойник расчёта долга измеряется сам.

  Проверки выше сканируют боевой SQL: убедиться, что он выполняет верное
  правило, здесь нечем — заглушки его не исполняют. А наборы жизненного цикла
  меряют долг ПО ДВОЙНИКУ (helpers/shop-debt-recalc), и пока двойник считает
  иначе, они принимают за верное то, чего в проде не происходит. Так и было:
  у возврата в двойнике не было поля orderId вовсе, то есть вычитался каждый
  проведённый возврат, включая те, чей заказ давно списан.

  Ниже — те же правила, что в боевом запросе, но выраженные числами.
*/
describe("двойник расчёта долга держит те же правила, что боевой запрос", () => {
  const T = 1, SHOP = 1;
  const base = (over: Partial<Parameters<typeof deriveShopDebt>[2]> = {}) =>
    ({ orders: [], payments: [], returns: [], ...over });

  it("оплата отменённого заказа остаётся деньгами магазина", () => {
    const debt = deriveShopDebt(T, SHOP, base({
      orders: [
        { id: 1, tenantId: T, shopId: SHOP, status: "cancelled", total: "300", paymentMethod: "cash" },
        { id: 2, tenantId: T, shopId: SHOP, status: "new", total: "500", paymentMethod: "debt" },
      ],
      payments: [{ tenantId: T, shopId: SHOP, orderId: 1, type: "payment", amount: "100" }],
    }));
    expect(debt).toBe("400.00");
  });

  it("оплата удалённого заказа кредитом не становится", () => {
    // Удаление значит «этого не было», включая деньги.
    const debt = deriveShopDebt(T, SHOP, base({
      orders: [
        { id: 1, tenantId: T, shopId: SHOP, status: "delivered", total: "300", paymentMethod: "cash", deletedAt: new Date() },
        { id: 2, tenantId: T, shopId: SHOP, status: "new", total: "500", paymentMethod: "debt" },
      ],
      payments: [{ tenantId: T, shopId: SHOP, orderId: 1, type: "payment", amount: "100" }],
    }));
    expect(debt).toBe("500.00");
  });

  it("возврат по списанному заказу второй раз долг не уменьшает", () => {
    const debt = deriveShopDebt(T, SHOP, base({
      orders: [
        { id: 1, tenantId: T, shopId: SHOP, status: "cancelled", total: "300", paymentMethod: "cash" },
        { id: 2, tenantId: T, shopId: SHOP, status: "new", total: "500", paymentMethod: "debt" },
      ],
      returns: [{ tenantId: T, shopId: SHOP, orderId: 1, status: "completed", totalAmount: "300" }],
    }));
    expect(debt).toBe("500.00");
  });

  it("возврат по живому доставленному заказу долг уменьшает", () => {
    const debt = deriveShopDebt(T, SHOP, base({
      orders: [{ id: 1, tenantId: T, shopId: SHOP, status: "delivered", total: "300", paymentMethod: "cash" }],
      returns: [{ tenantId: T, shopId: SHOP, orderId: 1, status: "completed", totalAmount: "120" }],
    }));
    expect(debt).toBe("180.00");
  });

  it("возврат без заказа вычитается всегда", () => {
    const debt = deriveShopDebt(T, SHOP, base({
      orders: [{ id: 1, tenantId: T, shopId: SHOP, status: "new", total: "500", paymentMethod: "debt" }],
      returns: [{ tenantId: T, shopId: SHOP, orderId: null, status: "completed", totalAmount: "200" }],
    }));
    expect(debt).toBe("300.00");
  });
});
