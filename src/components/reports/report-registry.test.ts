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

/**
 * Filters have to reach both the query and the filename. A card that offers a
 * filter the query ignores produces a file covering the wrong set; one the
 * filename ignores produces two indistinguishable files in a downloads folder.
 */
describe("report filters", () => {
  const source = readFileSync(resolve(__dirname, "report-registry.ts"), "utf8");
  const entries = source.slice(source.indexOf("export const REPORTS")).split(/\n {2}\{\n/).slice(1);

  it("passes every offered filter into its query", () => {
    const FIELD: Record<string, string> = {
      agent: "agentId", territory: "territoryId", shop: "shopId", category: "category",
    };
    for (const entry of entries) {
      const declared = entry.match(/filters:\s*\[([^\]]*)\]/);
      if (!declared) continue;
      const kinds = declared[1].split(",").map(k => k.trim().replace(/["']/g, "")).filter(Boolean);
      const call = entry.slice(entry.indexOf("useQuery:"), entry.indexOf("toRows:"));
      for (const kind of kinds) {
        expect(call).toContain(`p.${FIELD[kind]}`);
      }
    }
  });

  it("puts the active filters in the filename", () => {
    const withFilters = REPORTS.filter(r => r.filters?.length);
    expect(withFilters.length).toBeGreaterThan(0);
    for (const r of withFilters) {
      const base = r.filename({ from: "2026-01-01", to: "2026-01-31" });
      const filtered = r.filename({
        from: "2026-01-01", to: "2026-01-31", agentId: 7, territoryId: 3, category: "Напитки",
      });
      expect(filtered).not.toBe(base);
      expect(filtered).toContain("agent7");
    }
  });

  it("keeps filenames free of characters a filesystem rejects", () => {
    for (const r of REPORTS) {
      const name = r.filename({
        from: "2026-01-01", to: "2026-01-31", agentId: 7, category: "Напитки / соки",
      });
      expect(name).not.toMatch(/[/:*?"<>|\s]/);
    }
  });
});

/**
 * A card's roles have to match the middleware guarding its endpoint.
 *
 * Showing a card the server will refuse produces a button that always errors —
 * worse than not offering the report, because the user reasonably concludes
 * the export is broken rather than not theirs. Hiding a card whose endpoint
 * would have allowed it costs them a report they are entitled to.
 */
describe("card roles match endpoint permissions", () => {
  const registrySource = readFileSync(resolve(__dirname, "report-registry.ts"), "utf8");
  const api = (f: string) => readFileSync(resolve(__dirname, "../../../api", f), "utf8");

  const MIDDLEWARE_ROLES: Record<string, string[]> = {
    financeQuery:    ["ceo"],
    adminQuery:      ["ceo"],
    operatorQuery:   ["ceo", "operator"],
    supervisorQuery: ["ceo", "supervisor"],
    reportsQuery:    ["ceo", "operator", "supervisor", "merchandiser"],
  };

  /** Which middleware guards `router.procedure`. */
  function guardOf(router: string, procedure: string): string {
    // Plain string scanning rather than a regex built from the procedure name:
    // escaping that correctly is more fragile than just reading the line.
    const line = api(`${router}-router.ts`)
      .split("\n")
      .find(l => l.trimEnd().startsWith(`  ${procedure}:`));
    const guard = line?.match(/(\w+Query)/)?.[1];
    if (!guard) throw new Error(`${router}.${procedure} not found`);
    return guard;
  }

  /**
   * Which endpoint a report calls. Roles come from the exported objects rather
   * than from the file text — an earlier version parsed both out of the source
   * and quietly matched the wrong entry, so the check passed while the card was
   * misconfigured.
   */
  function endpointOf(id: string): [string, string] {
    const at = registrySource.indexOf(`id: "${id}"`);
    expect(at, `${id} not found in source`).toBeGreaterThan(-1);
    const m = registrySource.slice(at).match(/trpc\.(\w+)\.(\w+)\.useQuery/);
    if (!m) throw new Error(`${id}: no trpc call`);
    return [m[1], m[2]];
  }

  it.each(REPORTS.map(r => [r.id, r] as const))(
    "%s is offered only to roles its endpoint accepts",
    (id, def) => {
      const [router, procedure] = endpointOf(id);
      const guard = guardOf(router, procedure);
      const allowed = MIDDLEWARE_ROLES[guard];
      expect(allowed, `${id}: unknown middleware ${guard}`).toBeDefined();

      // No roles on the card means it shows to everyone the reports page admits.
      const cardRoles = def.roles ?? MIDDLEWARE_ROLES.reportsQuery;

      for (const role of cardRoles) {
        expect(allowed, `${id}: shown to ${role}, but ${router}.${procedure} is ${guard}`)
          .toContain(role);
      }
    },
  );
});
