/**
 * Планы продаж в демо жюри: от темпа агента, круглые, с разными цветами.
 *
 * Без планов «Прогноз плана» и KPI агента писали «Reja yo'q» — жюри видело
 * пустой план (05.10.2026).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pitchPlanFor, PITCH_PLAN_MULTIPLIERS } from "../services/pitch-demo";

describe("pitchPlanFor — план из темпа", () => {
  it("круглая сумма по 500 тыс. от темпа × множитель", () => {
    expect(pitchPlanFor(10_000_000, 20, 1.25)).toEqual({ amount: 12_500_000, orderCount: 25 });
    expect(pitchPlanFor(20_300_000, 37, 0.92).amount % 500_000).toBe(0);
  });

  it("агенту без продаж — скромный план, а не ноль", () => {
    expect(pitchPlanFor(0, 0, 1.06)).toEqual({ amount: 5_000_000, orderCount: 10 });
  });

  it("множители дают все три цвета прогноза: выше темпа, чуть выше, ниже", () => {
    expect(Math.max(...PITCH_PLAN_MULTIPLIERS)).toBeGreaterThanOrEqual(1.15);
    expect(PITCH_PLAN_MULTIPLIERS.some(m => m > 1 && m < 1.1)).toBe(true);
    expect(Math.min(...PITCH_PLAN_MULTIPLIERS)).toBeLessThan(1);
  });

  it("досев жюри ставит планы, только если их ещё нет, и пишет их в sales_targets", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../services/pitch-demo.ts"), "utf8");
    const body = src.slice(src.indexOf("let targetsAdded = 0"));
    expect(body).toMatch(/from\(salesTargets\)\.where\(eq\(salesTargets\.tenantId, tenantId\)\)/);
    expect(body).toMatch(/if \(Number\(targets\) === 0\)/);
    expect(body).toMatch(/db\.insert\(salesTargets\)\.values\(targetRows\)/);
  });
});
