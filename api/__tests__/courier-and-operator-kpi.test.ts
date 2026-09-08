import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * KPI у курьера и оператора: пункт меню не должен вести в отказ.
 *
 * У обоих «KPI» стоит в нижней панели, и маршрут их туда пускает, — а сервер
 * запросы отклонял. Пункт всегда вёл в «не удалось загрузить», где «Повторить»
 * повторяет тот же отказ: заявка отклонена не сбоем, а правами.
 *
 * Курьер: считать ему есть что своё — расчёт уже берёт доставки по
 * orders.courier_id и собранные деньги по payments.created_by. Но агентский
 * вид ему не подходит: там визиты, заказы, средний чек, возвраты и магазины,
 * которых у курьера нет.
 *
 * Оператор: приравнен к директору решением владельца — видит список агентов и
 * разбор по каждому. Своя зарплата у него фиксированная сама собой: комиссия
 * считается процентом от заказов, которые человек ОФОРМИЛ, а оператор их не
 * оформляет.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const MW = read("api/middleware.ts");
const KPI = read("api/kpi-router.ts");
const PAGE = read("src/pages/AgentKpi.tsx");
const SERVICE = read("api/services/kpi.ts");

function rolesOf(kind: string): string[] {
  const at = MW.indexOf(`export const ${kind}`);
  expect(at, `вид процедуры ${kind} не найден`).toBeGreaterThan(0);
  const m = MW.slice(at, MW.indexOf(";", at)).match(/requireRole\(\[([^\]]+)\]\)/);
  expect(m, `${kind} без requireRole`).not.toBeNull();
  return m![1].split(",").map((x) => x.trim().replace(/"/g, ""));
}

function kindOf(op: string): string {
  const m = KPI.match(new RegExp(`^  ${op}:\\s*(\\w+Query)`, "m"));
  expect(m, `${op} не найдена`).not.toBeNull();
  return m![1];
}

describe("курьер и свой KPI", () => {
  it("может открыть собственные числа", () => {
    expect(rolesOf(kindOf("courierKpi")), "курьеру снова закрыли его же KPI").toContain("courier");
  });

  it("чужого при этом не открылось", () => {
    // Список агентов и разбор по каждому — не для курьера.
    expect(rolesOf(kindOf("agentList"))).not.toContain("courier");
    expect(rolesOf(kindOf("agentDetail"))).not.toContain("courier");
  });

  it("видит свой экран, а не агентский", () => {
    // В агентском виде визиты, средний чек и возвраты — у курьера всё нули.
    expect(PAGE).toContain("CourierKpiView");
    expect(PAGE).toContain('const isCourier = user?.role === "courier"');
  });

  it("агентский расчёт ему даже не запрашивают", () => {
    /*
      Он отвечает нулями по визитам, планам и выручке и оценкой «F» — не
      потому что человек плохо работает, а потому что меряет не то. Раз экран
      этих чисел не показывает, и спрашивать их незачем.
    */
    const line = PAGE.split("\n").find((l) => l.includes("kpi.agentKpi.useQuery"));
    expect(line, "запрос агентского KPI не найден").toBeDefined();
    expect(line!, "курьеру снова считают агентский KPI").toContain("!isCourier");
  });
});

/*
  ── Зарплата курьера ────────────────────────────────────────────────────────

  Раньше её не запрашивали вовсе, и это было верно: агентский расчёт давал
  курьеру «оклад и три нуля». Комиссия — процент от заказов, которые человек
  ОФОРМИЛ (у курьера orders.agent_id пуст), премия — от оценки по визитам и
  планам, которых ему не ставят, вычет — за подозрительные визиты, которых он
  не делает.

  Решение владельца: фиксированная сумма за каждую довезённую заявку. Срывы её
  не уменьшают — они видны в показателях, но платят за факт.
*/
describe("зарплата курьера", () => {
  const salary = SERVICE.slice(SERVICE.indexOf("export async function calculateSalary"));

  it("теперь запрашивается", () => {
    const line = PAGE.split("\n").find((l) => l.includes("kpi.salary.useQuery"));
    expect(line, "запрос зарплаты не найден").toBeDefined();
    expect(line!, "курьеру снова отключили зарплату").not.toContain("!isCourier");
  });

  it("считается ставкой за доставку, а не процентом", () => {
    expect(salary).toContain("deliveredCount * deliveryRate");
  });

  it("итог курьера — только оклад и доставки", () => {
    /*
      Без этой проверки к сумме легко вернутся комиссия, премия и вычет: все
      три в той же функции строкой выше, и все три у курьера ноль или мусор.
    */
    const total = salary.slice(salary.indexOf("const totalSalary"), salary.indexOf("return {"));
    expect(total).toContain("baseSalary + deliveryPay");
    expect(total).toMatch(/isCourier/);
  });

  it("срывы выплату не уменьшают", () => {
    // Платим за факт: сорванные видны в показателях, но из денег не вычитаются.
    const total = salary.slice(salary.indexOf("const totalSalary"), salary.indexOf("return {"));
    expect(total).not.toMatch(/failed/);
  });

  it("строку комиссии курьеру не пишут", () => {
    // Запись означала бы «комиссия ноль» вместо «комиссии нет».
    expect(salary).toContain("persist && !isCourier");
  });

  it("доставки считаются по дате доставки, а не создания заказа", () => {
    /*
      Заказ мог быть оформлен в конце месяца, а доехать в начале следующего.
      По дате создания доставка попала бы в месяц, в котором курьер её ещё не
      делал, и в свой месяц не попала бы вовсе — человек недосчитался бы денег.
    */
    const stats = SERVICE.slice(
      SERVICE.indexOf("export async function calculateCourierStats"),
      SERVICE.indexOf("export interface AgentListEntry"),
    );
    expect(stats).toContain("COALESCE(${orders.deliveredAt}, ${orders.createdAt})");
  });

  it("деньги считаются по тому, кто их внёс", () => {
    /*
      Не по заказу: тот же заказ мог частью погасить агент при визите, и эти
      деньги курьеру не приписываются.
    */
    const stats = SERVICE.slice(
      SERVICE.indexOf("export async function calculateCourierStats"),
      SERVICE.indexOf("export interface AgentListEntry"),
    );
    expect(stats).toContain("payments.createdBy");
  });
});

describe("оператор наравне с директором", () => {
  it("видит список агентов и разбор", () => {
    for (const op of ["agentList", "agentDetail", "territoryKpi"]) {
      expect(rolesOf(kindOf(op)), `оператору закрыт ${op}`).toContain("operator");
    }
  });

  it("своя зарплата ему запрашивается", () => {
    const line = PAGE.split("\n").find((l) => l.includes("kpi.salary.useQuery"));
    expect(line!, "оператор снова не видит свой оклад").toContain("isOperator");
  });

  it("оклад не показывают, пока он не заведён", () => {
    // Карточка с нулём выдавала бы за настоящую цифру незаполненное поле.
    expect(PAGE).toContain("mySalary.totalSalary > 0");
  });
});
