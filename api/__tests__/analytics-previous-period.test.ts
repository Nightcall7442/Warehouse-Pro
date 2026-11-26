import { describe, it, expect, vi } from "vitest";

vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));
const { previousPeriod } = await import("../analytics-router");

/*
  Прошлый период в P&L — той же длины (бизнес-аудит 19.11.2026): неделя
  07–13 сравнивалась с 01–06, на день короче, и неизменные продажи давали
  «+16,7%».
*/
describe("прошлый период для сравнения", () => {
  it("неделя — с предыдущей неделей той же длины", () => {
    expect(previousPeriod("2026-11-07", "2026-11-13")).toEqual({ prevFrom: "2026-10-31", prevTo: "2026-11-06" });
  });
  it("один день — с предыдущим днём, а не с пустым периодом", () => {
    expect(previousPeriod("2026-11-13", "2026-11-13")).toEqual({ prevFrom: "2026-11-12", prevTo: "2026-11-12" });
  });
  it("30 дней — с предыдущими 30", () => {
    expect(previousPeriod("2026-11-01", "2026-11-30")).toEqual({ prevFrom: "2026-10-02", prevTo: "2026-10-31" });
  });
});
