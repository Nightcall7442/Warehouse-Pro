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
    expect(rolesOf(kindOf("agentKpi")), "курьеру снова закрыли его же KPI").toContain("courier");
  });

  it("чужого при этом не открылось", () => {
    // Список агентов и разбор по каждому — не для курьера.
    expect(rolesOf(kindOf("agentList"))).not.toContain("courier");
    expect(rolesOf(kindOf("agentDetail"))).not.toContain("courier");
  });

  it("видит свой экран, а не агентский", () => {
    // В агентском виде визиты, средний чек и возвраты — у курьера всё нули.
    expect(PAGE).toContain("function CourierView");
    expect(PAGE).toContain('const isCourier = user?.role === "courier"');
  });

  it("зарплату курьеру не запрашивают", () => {
    /*
      Она считается по заказам, которые человек оформил, — у курьера их нет.
      Ноль, выданный за настоящую цифру, хуже отсутствия цифры.
    */
    const line = PAGE.split("\n").find((l) => l.includes("kpi.salary.useQuery"));
    expect(line, "запрос зарплаты не найден").toBeDefined();
    expect(line!, "курьеру снова запрашивают зарплату").toContain("!isCourier");
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
