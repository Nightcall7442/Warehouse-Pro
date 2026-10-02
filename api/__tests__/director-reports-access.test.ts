/**
 * Кому открыты «Прибыль», ABC и прогноз плана — по тексту объявлений.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * reports.abc открыт шире, чем P&L (по выручке его смотрят офис и
 * супервайзер), а «по прибыли» внутри — только финансам. Круг финансов
 * выписан в middleware дважды: requireRole(["ceo"]) у financeQuery (его
 * читают стражи ролей) и FINANCE_ROLES (его читает reports.abc). Расширь
 * одно и забудь другое — и наценка утечёт офису через ABC, хотя P&L закрыт.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. FINANCE_ROLES — ровно тот же список, что у financeQuery.
 *  2. reports.margin — financeQuery; reports.abc — reportsQuery с отказом
 *     «по прибыли» не-финансам; salesTarget.forecast — managementQuery.
 *  (Как это работает на деле — real-db/margin-report, abc-report,
 *  plan-forecast: там роли зовут настоящие ручки.)
 *
 * ── Нарочная поломка ────────────────────────────────────────────────────────
 *
 * Дописать "operator" в FINANCE_ROLES — падает первая проверка.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FINANCE_ROLES } from "../middleware";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("доступ к отчётам директора", () => {
  it("FINANCE_ROLES — тот же круг, что у financeQuery", () => {
    const mw = read("middleware.ts");
    const m = mw.match(/export const financeQuery\s*=\s*authedQuery\.use\(requireRole\(\[([^\]]+)\]\)\)/);
    expect(m, "financeQuery без requireRole").not.toBeNull();
    const roles = m![1].split(",").map(x => x.trim().replace(/["']/g, "")).filter(Boolean);
    expect([...FINANCE_ROLES].sort()).toEqual(roles.sort());
  });

  it("маржа — финансам, ABC — отчётным ролям с отказом «по прибыли», прогноз — тем, кто видит планы всех", () => {
    const reports = read("reports-router.ts");
    expect(reports).toMatch(/\n {2}margin: financeQuery\n/);
    expect(reports).toMatch(/\n {2}abc: reportsQuery\n/);
    const abc = reports.slice(reports.indexOf("  abc: reportsQuery"), reports.indexOf("  noOrderVisits:"));
    expect(abc).toContain(`input.metric === "profit" && !finance`);
    expect(abc).toContain(`code: "FORBIDDEN"`);
    expect(read("sales-target-router.ts")).toMatch(/\n {2}forecast: managementQuery\n/);
  });
});
