import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Цифры в отчётах: пять расхождений, которые руководитель видел каждый день.
 *
 * Все пять подтверждены чтением кода с числовым примером, и у каждого правка
 * отдельно разбиралась на предмет побочных последствий — в двух случаях разбор
 * показал, что очевидная правка оставляет дыру открытой.
 *
 * Проверяется по исходнику: это запросы к MySQL, и поддельная база, которая
 * не воспроизводит ни соединений, ни COALESCE, доказала бы здесь ровно ничего.
 * Смысл теста — чтобы ни одно из правил не вернулось к прежнему виду.
 */

const read = (f: string) => readFileSync(join(process.cwd(), "api", f), "utf8");

describe("выручка считается по доставленным заказам", () => {
  const SRC = read("analytics-router.ts");

  it("эффективность агентов не берёт заказы любого статуса", () => {
    // Было: liveOrderConditions — «любой статус, кроме удалённых». Отменённый
    // заказ на 5 000 000 попадал в выручку агента: при одном доставленном на
    // 1 000 000 отчёт показывал 6 000 000 и средний чек 3 000 000 вместо
    // 1 000 000. Соседний «Продажи по магазинам» показывал 1 000 000 —
    // расхождение в шесть раз на одних и тех же данных.
    // Ищется ПРИСВОЕНИЕ, а не упоминание имени: оно осталось в комментарии как
    // объяснение прежней ошибки.
    const proc = SRC.slice(SRC.indexOf("agentPerformance:"), SRC.indexOf("agentPerformance:") + 1200);
    expect(proc).toMatch(/=\s*revenueOrderConditions\(/);
    expect(proc, "вернулся отбор по любому статусу").not.toMatch(/=\s*liveOrderConditions\(/);
  });

  it("во всём файле не осталось liveOrderConditions для выручки", () => {
    expect(SRC).not.toMatch(/=\s*liveOrderConditions\(/);
  });
});

describe("карточки прибыли и график считают по одному правилу", () => {
  const SRC = read("analytics-router.ts");

  it("период выручки собирается общим помощником", () => {
    // Набор условий был выписан руками и фильтра удалённых заказов не имел,
    // тогда как месячный график на том же экране считает через
    // revenueOrderConditions. Из двух доставленных заказов по 9 000 000, один
    // из которых удалён, карточка показывала 18 000 000, а график под ней —
    // 9 000 000.
    expect(SRC).toContain("revenuePeriodConditions(tid, dateFrom, dateTo)");
  });

  it("помощник несёт и статус, и фильтр удалённых, и конец дня", () => {
    const helper = read("lib/order-status.ts");
    const fn = helper.slice(helper.indexOf("export function revenuePeriodConditions"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("...revenueOrderConditions(tenantId)");
    // Даты приходят полуночью: без расширения верхней границы заказ,
    // оформленный сегодня днём, не попадал бы в период «по сегодня».
    expect(body).toContain('23:59:59');
  });
});

describe("себестоимость считается по доставленному количеству", () => {
  const analytics = read("analytics-router.ts");
  const dashboard = read("dashboard-router.ts");

  it("нигде не осталось умножения на заказанное количество", () => {
    // Заказ 20 шт по 15 000, себестоимость 9 000; доставлено 20 из 100
    // заказанных — выручка падает до доставленной, а себестоимость считалась
    // по 100 шт. Валовая прибыль показывалась отрицательной на нормальной
    // сделке.
    for (const [name, src] of [["analytics-router", analytics], ["dashboard-router", dashboard]] as const) {
      expect(src, `${name}: себестоимость снова по заказанному количеству`)
        .not.toMatch(/SUM\(\$\{orderItems\.quantity\} \* /);
    }
  });

  it("используется общее выражение доставленного количества", () => {
    const uses = (analytics.match(/deliveredQty\(\)/g) ?? []).length;
    // Пять мест себестоимости плюс выручка и количество в отчёте по товарам.
    expect(uses).toBeGreaterThanOrEqual(6);
    expect(dashboard).toContain("deliveredQty()");
  });

  it("выручка по товарам считается из того же количества, что и себестоимость", () => {
    // orderItems.subtotal курьерский путь частичного возврата не переписывает:
    // там заполняется только deliveredQuantity. Взяв выручку из subtotal, а
    // себестоимость из доставленного, отчёт показывал бы прибыль, которой нет.
    // Проверка по всему файлу, а не по одной процедуре: выручка по товарам
    // считается в трёх отчётах, и поправив один, остальные два продолжали бы
    // показывать возвращённый товар проданным.
    expect(analytics).toContain("deliveredQty()} * ${orderItems.unitPrice}");
    expect(analytics, "где-то выручка снова берётся из subtotal")
      .not.toMatch(/SUM\(\$\{orderItems\.subtotal\}\)/);
  });

  it("сводка руководителя берёт себестоимость из строки заказа, а не из товара", () => {
    // products.costPrice — цена СЕГОДНЯ: подняли закупку, и вся прошлая
    // прибыль пересчиталась задним числом. В строке заказа она зафиксирована
    // на момент продажи.
    expect(dashboard).not.toMatch(/\* \$\{products\.costPrice\}/);
    expect(dashboard).toContain("${orderItems.costPrice}");
  });
});

describe("список агентов и карточка агента считают одинаково", () => {
  const SRC = read("services/kpi.ts");

  it("список берёт тот же помощник, что и карточка", () => {
    // Два доставленных заказа по 1 000 000, один удалён: карточка агента
    // показывала 1 000 000 (за вычетом возвратов), список — 2 000 000. На
    // списочной цифре считается балл KPI, где выручка весит четверть.
    const fn = SRC.slice(SRC.indexOf("getAgentList"));
    const body = fn.slice(0, fn.indexOf("groupBy(orders.agentId)"));
    expect(body).toContain("...revenueOrderConditions(tenantId)");
  });
});

describe("завершение прихода не теряет расходы", () => {
  const SRC = read("arrival-router.ts");

  it("неуказанные расходы берутся из записи, а не из нуля", () => {
    // Приход: топливо 100 000, дорога 50 000, прочее 20 000, итого 170 000.
    // Оператор завершает, уточнив только топливо — 120 000. Прежний код давал
    // итог 120 000, оставив в колонках дорогу и прочее: строка противоречит
    // сама себе, а операционные расходы занижены на 70 000. Навсегда:
    // завершённый приход больше не редактируется.
    expect(SRC).toContain("data.fuelCost  ?? lockedArrival.fuelCost");
    expect(SRC).toContain("data.tollCost  ?? lockedArrival.tollCost");
    expect(SRC).toContain("data.otherCost ?? lockedArrival.otherCost");
    expect(SRC, 'вернулась подстановка нуля').not.toMatch(/data\.tollCost\s+\?\?\s+"0"/);
  });

  it("расходы читаются под той же блокировкой, что и статус", () => {
    // Отдельным запросом они читались бы уже после того, как их мог поменять
    // другой вызов.
    const sel = SRC.slice(SRC.indexOf("const [lockedArrival]"));
    const body = sel.slice(0, sel.indexOf(".for(\"update\")"));
    for (const col of ["fuelCost", "tollCost", "otherCost"]) {
      expect(body, `${col} не читается под блокировкой`).toContain(`${col}: arrivals.${col}`);
    }
  });
});
