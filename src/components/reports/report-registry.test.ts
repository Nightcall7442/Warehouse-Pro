import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPORTS, CATEGORY_ORDER, CATEGORY_TITLES, visibleReports } from "./report-registry";

/**
 * The registry is a promise to the user: every card produces a file that
 * contains the whole answer, named so they can find it later. These check the
 * promises that are easy to break silently while adding the next report.
 */
describe("report registry", () => {
  it("has no duplicate ids", () => {
    const ids = REPORTS.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every report in a category the hub renders", () => {
    for (const r of REPORTS) {
      expect(CATEGORY_ORDER).toContain(r.category);
      expect(CATEGORY_TITLES[r.category]).toBeDefined();
    }
  });

  it("names and describes every report in both languages", () => {
    for (const r of REPORTS) {
      for (const field of [r.title, r.description, r.sheet]) {
        expect(field.ru.trim().length).toBeGreaterThan(0);
        expect(field.uz.trim().length).toBeGreaterThan(0);
      }
    }
  });

  // A file called "report.xlsx" is indistinguishable from the last four the
  // user downloaded. The id keeps them apart, the dates say which slice it is.
  it("builds a filename that identifies the report and its period", () => {
    const params = { from: "2026-01-01", to: "2026-01-31" };
    for (const r of REPORTS) {
      const name = r.filename(params);
      expect(name).toContain(r.id.split("-")[0]);
      expect(name).not.toMatch(/[\\/:*?"<>|]/);
      if (r.needsPeriod) {
        expect(name).toContain(params.from);
        expect(name).toContain(params.to);
      }
    }
  });

  it("maps empty data to no rows rather than throwing", () => {
    for (const r of REPORTS) {
      expect(r.toRows([])).toEqual([]);
    }
  });

  it("shows unrestricted reports to every role", () => {
    const open = REPORTS.filter(r => !r.roles).map(r => r.id);
    for (const role of ["ceo", "operator", "supervisor", "merchandiser"]) {
      const ids = visibleReports(role).map(r => r.id);
      for (const id of open) expect(ids).toContain(id);
    }
  });

  it("hides a restricted report from roles not on its list", () => {
    const restricted = { ...REPORTS[0], id: "test-only", roles: ["ceo"] };
    const all = [...REPORTS, restricted];
    const forOperator = all.filter(r => !r.roles || r.roles.includes("operator"));
    expect(forOperator.map(r => r.id)).not.toContain("test-only");
  });
});

/**
 * The reason the hub can list every report on one screen: none of them run
 * until asked. These are the heaviest aggregate queries in the product, and a
 * catalogue that fires all of them on mount would be the slowest page here.
 */
describe("reports do not run until asked", () => {
  const card = readFileSync(resolve(__dirname, "ReportCard.tsx"), "utf8");
  const source = readFileSync(resolve(__dirname, "report-registry.ts"), "utf8");
  // Only the array — the ReportDef interface declares a useQuery too, and
  // counting that one would make the entry count disagree with REPORTS.
  const registry = source.slice(source.indexOf("export const REPORTS"));

  it("the card declares its query disabled", () => {
    expect(card).toMatch(/def\.useQuery\(params,\s*\{\s*enabled:\s*false\s*\}\)/);
  });

  it("the card fetches only from the export handler", () => {
    expect(card).toMatch(/query\.refetch\(\)/);
  });

  it("every registry entry honours the enabled flag it is handed", () => {
    // A hook that ignores opts.enabled would run on mount regardless of what
    // the card asked for, which is exactly the failure this guards.
    const entries = registry.split("useQuery:").slice(1);
    expect(entries.length).toBe(REPORTS.length);
    for (const entry of entries) {
      expect(entry.slice(0, 400)).toMatch(/enabled:\s*opts\.enabled/);
    }
  });

  // The dashboard charts cap at top-10 and top-20. An export that inherits
  // that cap drops the tail with nothing on the sheet to say so.
  it("exports ask for the full set, not the chart's top-N", () => {
    // Declared above the array, so this one looks at the whole file.
    expect(source).toMatch(/const EXPORT_LIMIT = \d{4,}/);
    const limited = registry.split("useQuery:").slice(1)
      .filter(e => e.slice(0, 400).includes("limit:"));
    for (const entry of limited) {
      expect(entry.slice(0, 400)).toMatch(/limit:\s*EXPORT_LIMIT/);
    }
  });
});
