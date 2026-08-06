import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ORDER_COLUMNS, defaultLayout, normaliseLayout, visibleColumns, layoutStorageKey,
  type ColumnId,
} from "./order-columns";

/**
 * The layout comes out of localStorage, which means it is user-editable, it
 * survives releases, and it will eventually contain something the code no
 * longer recognises. None of that may take the orders page down or silently
 * lose a column, so most of these are about bad input rather than good.
 */
describe("order columns", () => {
  it("has no duplicate ids", () => {
    const ids = ORDER_COLUMNS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels every column in both languages", () => {
    for (const c of ORDER_COLUMNS) {
      expect(c.label.ru.trim().length).toBeGreaterThan(0);
      expect(c.label.uz.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the order number first and the actions last", () => {
    const order = defaultLayout().order;
    expect(order[0]).toBe("orderNumber");
    expect(order[order.length - 1]).toBe("actions");
  });

  // A table with no identifier column and no way to act on a row is not a
  // table anyone can work from, so these two are not merely discouraged.
  it("locks the columns that make the table usable at all", () => {
    const locked = ORDER_COLUMNS.filter(c => c.locked).map(c => c.id);
    expect(locked).toEqual(["orderNumber", "actions"]);
  });

  it("shows every locked column by default", () => {
    for (const c of ORDER_COLUMNS.filter(c => c.locked)) {
      expect(c.defaultVisible).toBe(true);
    }
  });
});

describe("normaliseLayout", () => {
  const ids = () => ORDER_COLUMNS.map(c => c.id);

  it("falls back to the default when nothing is stored", () => {
    expect(normaliseLayout(null)).toEqual(defaultLayout());
    expect(normaliseLayout(undefined)).toEqual(defaultLayout());
  });

  it("falls back on junk rather than throwing", () => {
    for (const junk of ["", 42, [], { order: "нет" }, { order: [] }, { hidden: 5 }]) {
      expect(() => normaliseLayout(junk)).not.toThrow();
      expect(normaliseLayout(junk).order.length).toBe(ORDER_COLUMNS.length);
    }
  });

  // A column removed in a later release leaves its id behind in everyone's
  // browser. Rendering it would look up a definition that no longer exists.
  it("drops ids it no longer recognises", () => {
    const layout = normaliseLayout({ order: ["orderNumber", "ghost-column", "actions"], hidden: ["also-gone"] });

    expect(layout.order).not.toContain("ghost-column");
    expect(layout.hidden).not.toContain("also-gone");
  });

  // The mirror case: a column added after the layout was saved is absent from
  // storage, and dropping it would mean nobody who ever opened the page sees
  // a new column again.
  it("adds columns the stored layout never heard of", () => {
    const layout = normaliseLayout({ order: ["orderNumber", "actions"], hidden: [] });

    expect(new Set(layout.order)).toEqual(new Set(ids()));
  });

  it("puts a newly added column where it was declared, not at the end", () => {
    const layout = normaliseLayout({ order: ["orderNumber", "actions"], hidden: [] });

    // "actions" is declared last and must stay behind the columns restored
    // around it, rather than being shoved along by every new arrival.
    expect(layout.order.indexOf("shopName")).toBeLessThan(layout.order.indexOf("actions"));
  });

  it("never lets a locked column end up hidden", () => {
    const layout = normaliseLayout({ order: ids(), hidden: ["orderNumber", "actions", "notes"] });

    expect(layout.hidden).toEqual(["notes"]);
    expect(visibleColumns(layout).map(c => c.id)).toContain("orderNumber");
    expect(visibleColumns(layout).map(c => c.id)).toContain("actions");
  });

  it("tolerates a duplicated id without rendering it twice", () => {
    const layout = normaliseLayout({ order: ["orderNumber", "shopName", "shopName", "actions"], hidden: [] });

    expect(layout.order.filter(id => id === "shopName")).toHaveLength(1);
  });

  it("keeps a stored order the user actually chose", () => {
    const custom: ColumnId[] = ["orderNumber", "total", "shopName", "createdAt"];
    const layout = normaliseLayout({ order: custom, hidden: [] });

    // The four they picked keep their relative order; everything else is
    // restored around them.
    const positions = custom.map(id => layout.order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("visibleColumns", () => {
  it("returns the default set when nothing is hidden by the user", () => {
    const visible = visibleColumns(defaultLayout()).map(c => c.id);
    const expected = ORDER_COLUMNS.filter(c => c.defaultVisible).map(c => c.id);

    expect(visible).toEqual(expected);
  });

  it("can be emptied down to the locked columns and no further", () => {
    const hidden = ORDER_COLUMNS.filter(c => !c.locked).map(c => c.id);
    const visible = visibleColumns(normaliseLayout({ order: ORDER_COLUMNS.map(c => c.id), hidden }));

    expect(visible.map(c => c.id)).toEqual(["orderNumber", "actions"]);
  });
});

/**
 * Office machines are shared: one browser, several people, sometimes several
 * companies. A layout keyed globally would follow whoever signs in next.
 */
describe("layoutStorageKey", () => {
  it("separates users and tenants", () => {
    expect(layoutStorageKey(1, 10)).not.toBe(layoutStorageKey(1, 11));
    expect(layoutStorageKey(1, 10)).not.toBe(layoutStorageKey(2, 10));
  });

  it("stays a usable key before the session is known", () => {
    expect(layoutStorageKey(undefined, undefined)).toMatch(/^orders-columns:/);
  });
});

/**
 * The point of the refactor: header and cell come from one array. If either
 * side ever goes back to a hand-written list they can drift, and a column
 * shifted by one reads as a data bug rather than a markup one.
 */
describe("the orders table renders from the config", () => {
  const page = readFileSync(resolve(__dirname, "../../pages/Orders.tsx"), "utf8");

  it("maps the same array for headers and for cells", () => {
    const maps = page.match(/cols\.columns\.map\(/g) ?? [];
    expect(maps.length).toBeGreaterThanOrEqual(2);
  });

  it("has no hand-written header list left", () => {
    expect(page).not.toMatch(/t\("ТЕРРИТОРИЯ", "HUDUD"\),/);
  });

  // colSpan on the loading and empty rows has to follow the visible count, or
  // hiding a column leaves those rows spanning past the end of the table.
  it("computes colSpan from the visible columns", () => {
    expect(page).not.toMatch(/colSpan=\{10\}/);
    expect(page).toMatch(/colSpan=\{cols\.columns\.length \+ 1\}/);
  });
});
