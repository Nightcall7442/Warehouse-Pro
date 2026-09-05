import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Блок «Зарплаты» для руководителя.
 *
 * Расчёт существовал и раньше (kpi.salaryReport), но его никто не показывал:
 * эндпоинт был мёртвым, а числа по людям приходилось собирать по карточкам KPI
 * поодиночке. Фонда оплаты — суммы, которая уходит из кассы, — не было видно
 * нигде.
 *
 * И считал он только агентов. У оператора, супервайзера и курьера зарплата
 * выходит фиксированной сама собой: комиссия и премия считаются от заказов,
 * которые человек ОФОРМИЛ, а они их не оформляют. Не показывать их означало
 * бы, что фонд на экране не сходится с тем, что платят на самом деле.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const KPI = read("api/kpi-router.ts");
const APP = read("src/App.tsx");
const PAGE = read("src/pages/Salaries.tsx");

describe("расчёт зарплат", () => {
  it("охватывает всю команду, а не только агентов", () => {
    const at = KPI.indexOf("salaryReport: supervisorQuery");
    expect(at, "salaryReport не найден").toBeGreaterThan(0);
    const body = KPI.slice(at, KPI.indexOf("});", at));
    expect(body, "снова считают только агентов").not.toMatch(/eq\(users\.role, "agent"\)/);
    expect(body).toContain("eq(users.status, \"active\")");
  });

  it("суперадминистратор в фонд организации не попадает", () => {
    // Он сотрудник платформы, а не этой организации.
    const at = KPI.indexOf("salaryReport: supervisorQuery");
    expect(KPI.slice(at, KPI.indexOf("});", at))).toContain("'superadmin'");
  });

  it("роль возвращается — по ней экран объясняет состав выплаты", () => {
    const at = KPI.indexOf("salaryReport: supervisorQuery");
    expect(KPI.slice(at, KPI.indexOf("});", at))).toContain("role: agent.role");
  });
});

describe("страница зарплат", () => {
  it("открыта только руководителю", () => {
    /*
      Это деньги сотрудников. Сам расчёт допускает и супервайзера — он и
      раньше мог его вызвать, — но открывать ему фонд оплаты должно быть
      отдельным решением, а не побочным эффектом новой страницы.
    */
    const at = APP.indexOf('path="/salaries"');
    expect(at, "маршрут зарплат не найден").toBeGreaterThan(0);
    const route = APP.slice(at, APP.indexOf("/>", at));
    expect(route).toContain('roles={["ceo"]}');
  });

  it("показывает фонд и его части", () => {
    // Вопрос директора обычно не «сколько всего», а «почему столько».
    expect(PAGE).toContain("ФОНД ОПЛАТЫ");
    expect(PAGE).toContain("ОКЛАДЫ");
    expect(PAGE).toContain("КОМИССИЯ");
    expect(PAGE).toContain("ПРЕМИИ");
  });

  it("незаполненный оклад назван прямо, а не показан нулём", () => {
    // Ноль здесь означает не «столько платим», а «не задано»; принять этот
    // вопрос дешевле, чем потом объяснять.
    expect(PAGE).toContain("оклад не задан");
  });
});
