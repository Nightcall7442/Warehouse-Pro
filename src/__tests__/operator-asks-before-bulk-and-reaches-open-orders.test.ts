import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Три дыры оператора, найденные разбором по ролям.
 *
 *   • Селект «Изменить статус» в панели выделения менял пачку без вопроса,
 *     а «Выполнить» рядом — с подтверждением. Один промах по списку — и
 *     пятьдесят заказов отменены.
 *   • В карточке заказа блок «Назначить курьера» стоял только у нового и
 *     обрабатываемого, а после сборки в лист (статус «отгружен») пропадал —
 *     ровно тогда, когда заказ и отдают курьеру. Панель списка и сервер
 *     давно работают по всем открытым статусам.
 *   • «Вернуть товар» поставщику показывалась только при долге; сервер долга
 *     не требует и зачитывает не больше остатка.
 *
 * Проверяется по исходнику: ломается это не отрисовкой, а условием, которое
 * сузят обратно при следующей правке.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("массовая смена статуса спрашивает", () => {
  const ORDERS = strip(read("src/pages/Orders.tsx"));
  const block = ORDERS.slice(ORDERS.indexOf("onChangeStatus={"), ORDERS.indexOf("onComplete={"));

  it("перед bulkUpdateStatus стоит confirm с числом заказов и целевым статусом", () => {
    expect(block, "смена статуса снова идёт без вопроса").toContain("await confirm({");
    expect(block).toContain("labelled(ORDER_STATUS_LABEL, newStatus, lang)");
    expect(block).toMatch(/\$\{ids\.length\} заказ\(ов\) в «\$\{label\}»/);
    expect(block, "mutate не за подтверждением").toMatch(/if \(ok\) bulkUpdateStatus\.mutate/);
  });
});

describe("карточка заказа: курьера назначают, пока заказ открыт", () => {
  const DETAIL = strip(read("src/pages/OrderDetail.tsx"));

  it("и запрос курьеров, и блок — по OPEN_STATUSES, а не по new/processing", () => {
    const couriers = DETAIL.slice(DETAIL.indexOf("trpc.user.list.useQuery("), DETAIL.indexOf("trpc.user.list.useQuery(") + 300);
    expect(couriers).toContain("OPEN_STATUSES.includes(order.status)");
    expect(DETAIL).toContain("{isOperatorOrCeo && OPEN_STATUSES.includes(order.status) && (");
    expect(DETAIL, "условие «новый или в обработке» вернулось к курьеру")
      .not.toMatch(/isOperatorOrCeo && \(order\.status === "new" \|\| order\.status === "processing"\) && \(\s*<div className="neo-card p-4">\s*<p[^>]*>\s*<Truck/);
  });
});

describe("возврат поставщику не зависит от долга", () => {
  const CP = strip(read("src/components/counterparties/CounterpartyDetail.tsx"));

  it("кнопка «Вернуть товар» стоит за одним onReturn", () => {
    const at = CP.indexOf("data-testid={`cp-return-${r.id}`}");
    expect(at).toBeGreaterThan(0);
    const before = CP.slice(at - 120, at);
    expect(before).toContain("{onReturn && (");
    expect(before, "возврат снова только при долге").not.toContain("r.debt > 0 && onReturn");
  });
});
