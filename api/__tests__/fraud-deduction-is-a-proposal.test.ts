/**
 * Вычет за подозрительные визиты — предложение, а не автоматика;
 * нет GPS ≠ фрод; подмена координат = фрод.
 *
 * Три беды одного расчёта. Формула (оклад × доля подозрительных × ½)
 * вычиталась из зарплаты сама, без решения и без строки в ведомости. День
 * без единой GPS-точки давал minDistance = Infinity → «агент был в
 * Infinityм от магазина» → +40 → подозрение → вычет. А единственный признак,
 * который не бывает случайным — координаты, подменённые эмулятором, — не
 * учитывался вовсе, хотя телефон о нём сообщает.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { verifyVisit } from "../services/anti-fraud";

const noDb = {} as never;
const plan = { id: 1, shopId: 7, planDate: new Date("2026-09-10"), agentId: 3, status: "visited", photoUrl: "p.jpg" };
const shop = { gpsLat: "41.3111", gpsLng: "69.2797", name: "Тест" };
const ctx = (duplicateCount = 1) => ({ plan, shop, duplicateCount });

describe("нет GPS ≠ фрод", () => {
  it("день без точек: не подозрение, без Infinity, помечен как непроверенный", async () => {
    const r = await verifyVisit(noDb, plan.id, 1, [], undefined, ctx());
    expect(r.isSuspicious).toBe(false);
    expect(r.fraudScore).toBe(0);
    expect(r.details.gpsMissing).toBe(true);
    expect(r.details.gpsVerified).toBe(false);
    expect(Number.isFinite(r.details.distanceToShop)).toBe(true);
    expect(r.reasons.join(" ")).not.toContain("Infinity");
    expect(r.reasons.join(" ")).toContain("Нет GPS");
  });

  it("точки есть, но далеко — подозрение остаётся как было", async () => {
    const far = [{ lat: "41.4000", lng: "69.4000", createdAt: new Date("2026-09-10T10:00:00Z") }];
    const r = await verifyVisit(noDb, plan.id, 1, far, undefined, ctx());
    expect(r.isSuspicious).toBe(true);
    expect(r.details.gpsMissing).toBe(false);
  });
});

describe("подмена координат = фрод", () => {
  it("хотя бы одна точка от эмулятора — подозрение, даже если она у магазина", async () => {
    const atShop = [
      { lat: shop.gpsLat, lng: shop.gpsLng, createdAt: new Date("2026-09-10T10:00:00Z"), mocked: true },
      { lat: shop.gpsLat, lng: shop.gpsLng, createdAt: new Date("2026-09-10T10:20:00Z"), mocked: false },
    ];
    const r = await verifyVisit(noDb, plan.id, 1, atShop, undefined, ctx());
    expect(r.details.gpsMocked).toBe(true);
    expect(r.isSuspicious).toBe(true);
    expect(r.reasons.join(" ")).toContain("Подменённые");
  });

  it("saveLocation принимает признак mocked и пишет его в agent_locations", () => {
    const src = readFileSync("api/agent-router.ts", "utf-8");
    const i = src.indexOf("saveLocation: fieldSalesQuery");
    const body = src.slice(i, i + 1800);
    expect(body).toContain("mocked: z.boolean().optional()");
    expect(body).toContain("mocked: input.mocked === true");
  });
});

describe("вычет — предложение к утверждению", () => {
  const kpi = readFileSync("api/services/kpi.ts", "utf-8");

  it("формула даёт только fraudDeductionProposed; из зарплаты уходит утверждённое", () => {
    expect(kpi).toContain("const fraudDeductionProposed = Number((baseSalary * (kpi.fraudRate / 100) * 0.5).toFixed(2));");
    expect(kpi).not.toMatch(/const fraudDeduction = Number\(\(baseSalary \*/);
    expect(kpi).toContain("commissionRecord?.fraudDeduction != null");
    expect(kpi).toContain("baseSalary + commissionAmount - fraudDeduction");
  });

  it("утверждение берётся только из строки условий за ЭТОТ период", () => {
    expect(kpi).toContain("termsAreThisPeriod");
    expect(kpi).toMatch(/termsAreThisPeriod && commissionRecord\?\.fraudDeduction != null/);
  });

  it("ответ показывает предложенную сумму директору", () => {
    expect(kpi).toContain("fraudDeductionProposed: isCourier ? 0 : fraudDeductionProposed");
  });

  it("утверждает директор, закрытый период не трогается", () => {
    const router = readFileSync("api/kpi-router.ts", "utf-8");
    const i = router.indexOf("setFraudDeduction: adminQuery");
    expect(i).toBeGreaterThan(0);
    const body = router.slice(i, i + 3000);
    expect(body).toContain('terms.status !== "pending"');
    expect(body).toContain("PRECONDITION_FAILED");
    expect(body).toContain('action: "salary.fraud_deduction"');
  });

  it("ведомость показывает предложение и кнопки применить/снять", () => {
    const page = readFileSync("src/pages/Salaries.tsx", "utf-8");
    expect(page).toContain("trpc.kpi.setFraudDeduction.useMutation");
    expect(page).toContain("fraud-apply-");
    expect(page).toContain("fraud-remove-");
  });
});
