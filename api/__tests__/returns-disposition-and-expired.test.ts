/**
 * Возврат решает, куда девать товар; просрочка не продаётся и не отгружается.
 *
 * Было: каждый проведённый возврат клал товар на полку — брак и просрочка
 * продавались следующим же заказом. А FEFO без условия по сроку отдавал
 * магазину ПЕРВОЙ именно сгоревшую партию: «раньше всех портится» она и есть.
 * available при этом считал просроченное годным.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { defaultDisposition } from "../returns-router";
import { expiredByProduct } from "../services/stock-ledger";

describe("куда девать вернувшийся товар", () => {
  it("брак, просрочка и порча — списать; пересорт и другое — на склад", () => {
    expect(defaultDisposition("defect")).toBe("write_off");
    expect(defaultDisposition("expired")).toBe("write_off");
    expect(defaultDisposition("damaged")).toBe("write_off");
    expect(defaultDisposition("wrong_item")).toBe("restock");
    expect(defaultDisposition("other")).toBe("restock");
  });

  it("проведение принимает выбор оператора и пишет его в строку возврата", () => {
    const src = readFileSync("api/returns-router.ts", "utf-8");
    expect(src).toContain('disposition: z.enum(["restock", "write_off"]).optional()');
    expect(src).toContain("const disposition = input.disposition ?? defaultDisposition(ret.reason);");
    expect(src).toContain('if (disposition === "restock") {');
    expect(src).toContain(".set({ status: input.status, disposition })");
  });

  it("экран даёт две кнопки, главная — по причине", () => {
    const page = readFileSync("src/pages/Returns.tsx", "utf-8");
    expect(page).toContain('"return-restock"');
    expect(page).toContain('"return-write-off"');
    expect(page).toContain("move.mutate({ id, status: to, disposition })");
  });
});

describe("просрочка вне отгрузки", () => {
  const door = readFileSync("api/services/stock-ledger.ts", "utf-8");

  it("отгрузка не берёт просроченные партии, списание берёт их первыми", () => {
    const i = door.indexOf("async function consumeBatches");
    const body = door.slice(i, i + 2500);
    expect(body).toContain("AND (expires_at IS NULL OR expires_at >= CURDATE())");
    expect(body).toMatch(/expiredToo \? sql`/);
    expect(door).toContain('uniform(items, entry.shift), entry.reason === "manual_adjustment"');
    expect(door).toContain("inBatches - q, true)");
  });

  it("годное к продаже = available − просроченное; отказ называет просрочку", () => {
    const order = readFileSync("api/services/order.ts", "utf-8");
    expect(order).toContain("const expired = await expiredByProduct(tx, tenantId, reserveWarehouseId, items.map(i => i.productId));");
    expect(order).toContain("const sellable = available - rotten;");
    expect(order).toContain("просрочено — годных");
  });

  it("expiredByProduct: собирает по товарам, без товаров в базу не ходит", async () => {
    const execute = vi.fn(async () => [[{ productId: 7, qty: "3.00" }], []]);
    const tx = { execute } as never;
    const m = await expiredByProduct(tx, 1, 1, [7, 8]);
    expect(m.get(7)).toBe(3);
    expect(m.get(8)).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);

    const none = await expiredByProduct(tx, 1, 1, []);
    expect(none.size).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
