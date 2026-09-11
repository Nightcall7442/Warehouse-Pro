/**
 * Оклад пишется и читается из commissions, а не из sales_targets.
 *
 * Обе величины жили в sales_targets.target_amount двумя независимыми путями
 * записи (kpi.setSalary и salesTarget.upsert). Здесь по тексту закреплено, что
 * setSalary не трогает sales_targets, а calculateSalary не читает оттуда
 * оклад; поведение на настоящей базе — real-db/salary-not-a-plan.test.ts.
 *
 * Нарочная поломка: верни в calculateSalary чтение target_amount как
 * baseSalary — вторая проверка падает.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTER = readFileSync(resolve(__dirname, "../kpi-router.ts"), "utf-8");
const KPI = readFileSync(resolve(__dirname, "../services/kpi.ts"), "utf-8");
const MIGRATION = readFileSync(resolve(__dirname, "../../db/migrations/0024_commissions_base_salary.sql"), "utf-8");

describe("оклад живёт в условиях оплаты", () => {
  it("setSalary пишет base_salary в commissions и не трогает sales_targets", () => {
    const body = ROUTER.slice(ROUTER.indexOf("setSalary: adminQuery"), ROUTER.indexOf("recordAudit", ROUTER.indexOf("setSalary: adminQuery")));
    expect(body).toContain("baseSalary: input.baseSalary.toFixed(2)");
    expect(body).not.toContain("salesTargets");
  });

  it("calculateSalary читает оклад из строки условий оплаты", () => {
    const body = KPI.slice(KPI.indexOf("export async function calculateSalary"), KPI.indexOf("\nexport ", KPI.indexOf("export async function calculateSalary") + 10));
    expect(body).toContain("const baseSalary = Number(commissionRecord?.baseSalary ?? 0)");
    expect(body).not.toMatch(/targetRecord\?\.targetAmount/);
  });

  it("миграция переносит прежние оклады, не стирая планов", () => {
    expect(MIGRATION).toMatch(/ADD `base_salary`/);
    expect(MIGRATION).toMatch(/INSERT INTO `commissions`[\s\S]*NOT EXISTS/);
    expect(MIGRATION).toMatch(/UPDATE `commissions`[\s\S]*base_salary` = 0\.00/);
    expect(MIGRATION).not.toMatch(/DELETE|DROP/);
  });
});
