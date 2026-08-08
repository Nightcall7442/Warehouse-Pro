import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Местных копий разборщика условий может становиться только меньше.
 *
 * В каждой такой копии разбор заканчивался одинаково — «всё, чего не поняли,
 * считаем выполненным». Понимали при этом разное: `eq` и `and` знали все
 * тридцать шесть файлов, `inArray` — четырнадцать, `isNull` — пять. Значит в
 * остальных фильтр «не удалённые» был выполнен всегда, и убери его кто-нибудь
 * из продакшена, тест остался бы зелёным.
 *
 * Это не теория. Выручку, считавшуюся по удалённым заказам, и долг, вычитавший
 * возвраты по ним же, мы правили руками — ни одну из этих ошибок стенд поймать
 * не мог, потому что молча одобрял непонятое условие.
 *
 * Общий разборщик лежит в helpers/fake-conditions.ts и на непонятое условие
 * падает с объяснением. Перевод тридцати пяти файлов — работа не на один заход:
 * каждый переведённый файл придётся разбирать отдельно, и упадут в нём ровно
 * те проверки, которые до сих пор были зелёными незаслуженно. Поэтому здесь
 * зафиксирована граница: список может сокращаться, но не расти.
 *
 * Переведя файл, удалите его из списка — вторая проверка это подтвердит.
 */

/** Файлы, ещё не переведённые на общий строгий разборщик. */
const LEGACY_EVALUATORS = [
  "api/__tests__/_audit-commission-evidence.test.ts",
  "api/__tests__/agent-router.test.ts",
  "api/__tests__/analytics-business.test.ts",
  "api/__tests__/arrival-router.test.ts",
  "api/__tests__/auth-router.test.ts",
  "api/__tests__/billing-router.test.ts",
  "api/__tests__/commission-business.test.ts",
  "api/__tests__/courier-router.test.ts",
  "api/__tests__/dashboard-router.test.ts",
  "api/__tests__/import-router.test.ts",
  "api/__tests__/import-territory.test.ts",
  "api/__tests__/integration.test.ts",
  "api/__tests__/invite-router.test.ts",
  "api/__tests__/kpi-router.test.ts",
  "api/__tests__/notification-router.test.ts",
  "api/__tests__/order-api.test.ts",
  "api/__tests__/order-business-logic.test.ts",
  "api/__tests__/price-list-router.test.ts",
  "api/__tests__/product-router.test.ts",
  "api/__tests__/reports-logs.test.ts",
  "api/__tests__/returns-router.test.ts",
  "api/__tests__/state-transitions.test.ts",
  "api/__tests__/stock-api.test.ts",
  "api/__tests__/stock-concurrency.test.ts",
  "api/__tests__/stock-races.test.ts",
  "api/__tests__/stripe-router.test.ts",
  "api/__tests__/tenant-router.test.ts",
  "api/__tests__/territory-router.test.ts",
  "api/__tests__/warehouse-business.test.ts",
  "api/__tests__/warehouse-multi-router.test.ts",
  "api/__tests__/warehouse-router.test.ts",
  "api/services/__tests__/onec-mapper.test.ts",
  "api/services/__tests__/onec-sync.test.ts",
  "api/services/__tests__/order.test.ts",
  "api/services/__tests__/stock.test.ts",
];

function filesWithLocalEvaluator(): string[] {
  const root = process.cwd();
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".test.ts")) continue;
      // Объявление собственной функции разбора — признак местной копии.
      // Переведённые файлы получают разборщик из общего помощника и своей
      // функции не объявляют.
      // Ищется именно ОБЪЯВЛЕНИЕ функции, а не упоминание имени: иначе этот
      // самый файл, где имя стоит образцом поиска, нашёл бы сам себя.
      if (/function evalCond\s*\(/.test(readFileSync(full, "utf8"))) {
        found.push(full.slice(root.length + 1).split(sep).join("/"));
      }
    }
  };

  walk(join(root, "api"));
  return found.sort();
}

describe("строгость поддельной базы", () => {
  const actual = filesWithLocalEvaluator();

  it("новых местных разборщиков не появилось", () => {
    const fresh = actual.filter(f => !LEGACY_EVALUATORS.includes(f));
    expect(
      fresh,
      "эти тесты объявляют свой разбор условий вместо общего строгого — непонятое условие в них будет считаться выполненным:\n  " +
      fresh.join("\n  "),
    ).toEqual([]);
  });

  it("список не разошёлся с действительностью", () => {
    // Запись о файле, который уже переведён, молча прикроет следующий такой же.
    const stale = LEGACY_EVALUATORS.filter(f => !actual.includes(f));
    expect(
      stale,
      "эти файлы уже переведены (или переименованы) — уберите их из LEGACY_EVALUATORS:\n  " + stale.join("\n  "),
    ).toEqual([]);
  });

  it("обход каталога не сломался", () => {
    // Страховка от «зелёного ни на чём»: пустой результат обхода сделал бы обе
    // проверки выше бессодержательными.
    expect(actual.length).toBeGreaterThan(0);
  });
});
