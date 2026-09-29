import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { exceedsReturnable, type ReturnableLine } from "../services/returnable";
import { canFileReturn } from "../../src/lib/permissions";
import { returnDraft, clampQty } from "../../src/lib/return-draft";

/**
 * Возврат из веба: правило остатка и границы ролей.
 *
 * Что было: остаток к возврату считал только returns.create и только внутри
 * себя — «да» или «нет». Окну в вебе нужно число по строке; посчитай его экран
 * сам, он разошёлся бы с сервером. Кнопки в вебе не было вовсе.
 *
 * Что проверяется:
 *   · create и returns.returnable берут остаток из ОДНОЙ функции
 *     (services/returnable.ts), своей копии в роутере нет;
 *   · дробное количество не ломает сравнение: 1.2 + 1.3 из 2.5 — можно;
 *   · returns.returnable открыт тем же ролям, что create, а кнопка на экране
 *     (canFileReturn) — ровно этим ролям, сверено с middleware.ts;
 *   · сумма в окне — целыми, строки без количества не уходят.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const ROUTER = read("api/returns-router.ts");
const MW = read("api/middleware.ts");
const ROLES = ["superadmin", "ceo", "operator", "agent", "supervisor", "merchandiser", "courier"];

const line = (shipped: number, returned: number): ReturnableLine => ({ productId: 1, shipped, returned, left: shipped - returned, unitPrice: 100 });

function rolesOf(kind: string): string[] {
  const at = MW.indexOf(`export const ${kind}`);
  expect(at, `вид процедуры ${kind} не найден`).toBeGreaterThan(0);
  const m = MW.slice(at, MW.indexOf(";", at)).match(/requireRole\(\[([^\]]+)\]\)/);
  expect(m, `${kind} без requireRole`).not.toBeNull();
  return m![1].split(",").map(x => x.trim().replace(/["']/g, ""));
}
const kindOf = (proc: string) => ROUTER.match(new RegExp(`^  ${proc}:\\s*(\\w+Query)`, "m"))?.[1];

describe("остаток к возврату — одно правило", () => {
  it("create проверяет по returnableLines и exceedsReturnable, своей суммы возвращённого в роутере нет", () => {
    const create = ROUTER.slice(ROUTER.indexOf("  create:"), ROUTER.indexOf("  updateStatus:"));
    expect(create).toContain("await returnableLines(db, ctx.tenant.id, input.orderId)");
    expect(create).toContain("exceedsReturnable(line, total)");
    expect(create).not.toMatch(/SUM\(\$\{returnItems\.quantity\}\)/);
  });
  it("returns.returnable отдаёт то же самое", () => {
    const proc = ROUTER.slice(ROUTER.indexOf("  returnable:"), ROUTER.indexOf("  create:"));
    expect(proc).toContain("returnableLines(db, ctx.tenant.id, input.orderId)");
  });
  it("возвращено + вписано сверх доставленного — отказ; ровно доставленное — можно, и с дробями", () => {
    expect(exceedsReturnable(line(10, 7), 3)).toBe(false);
    expect(exceedsReturnable(line(10, 7), 4)).toBe(true);
    expect(exceedsReturnable(line(2.5, 1.2), 1.3)).toBe(false);
    expect(exceedsReturnable(line(2.5, 1.2), 1.301)).toBe(true);
  });
});

describe("кто может", () => {
  it("returns.returnable — тот же вид процедуры, что create", () => {
    expect(kindOf("returnable")).toBe(kindOf("create"));
    expect(kindOf("create")).toBe("fieldSalesQuery");
  });
  it("canFileReturn — это fieldSalesQuery", () => {
    const allowed = new Set(rolesOf("fieldSalesQuery"));
    for (const role of ROLES) expect(canFileReturn(role), role).toBe(allowed.has(role));
    expect(canFileReturn(undefined)).toBe(false);
  });
});

describe("черновик окна", () => {
  const lines = [
    { productId: 11, name: "Йогурт", unit: "pcs", unitPrice: 12500, left: 3 },
    { productId: 12, name: "Кефир", unit: "pcs", unitPrice: 9000.5, left: 4 },
    { productId: 13, name: "Подарок", unit: "pcs", unitPrice: 0, left: 1 },
  ];
  it("пустые и нулевые строки не уходят, сумма целыми", () => {
    const d = returnDraft(lines, { 11: "2", 12: "1", 13: "" });
    expect(d.items).toEqual([{ productId: 11, quantity: 2, unitPrice: 12500 }, { productId: 12, quantity: 1, unitPrice: 9000.5 }]);
    expect(d.total).toBe(34001);
  });
  it("бесплатную строку можно вернуть: вход сервера требует цену > 0, в документ ляжет цена заказа", () => {
    expect(returnDraft(lines, { 13: "1" })).toEqual({ items: [{ productId: 13, quantity: 1, unitPrice: 0.01 }], total: 0 });
  });
  it("больше остатка не вписать", () => {
    expect(clampQty("99", 3)).toBe("3");
    expect(clampQty("1,5", 3)).toBe("1.5");
    expect(clampQty("", 3)).toBe("");
  });
});
