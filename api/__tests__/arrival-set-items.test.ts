/**
 * Приход по накладной и правка строк до проведения — стражи сервера.
 *
 *   · строка может прийти нулём, если есть «по накладной»; без того и
 *     другого, и с отрицательным — отказ схемы;
 *   · setItems — под тем же правом, что создание прихода, с замком строки
 *     прихода и отказом для проведённого;
 *   · проведение пропускает строки с нулём до движения остатка;
 *   · товар дважды в приходе — отказ до базы.
 * Поведение на настоящей базе — real-db/arrival-sheet-flow.test.ts.
 *
 * Нарочная поломка: убери `if (!(qty > 0)) continue;` — падает третий тест.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");

type Parser = { safeParse: (v: unknown) => { success: boolean } };
async function itemSchema(): Promise<Parser> {
  const { arrivalRouter } = await import("../arrival-router");
  const proc = (arrivalRouter as unknown as { _def: { procedures: Record<string, { _def: { inputs: Parser[] } }> } })._def.procedures.setItems;
  return proc._def.inputs[0];
}

describe("строка прихода", () => {
  it("нулём — только с «по накладной»; пустая и отрицательная — отказ", async () => {
    const schema = await itemSchema();
    const one = (item: Record<string, unknown>) => schema.safeParse({ id: 1, items: [{ productId: 1, ...item }] }).success;
    expect(one({ quantity: "0", expectedQuantity: "24" })).toBe(true);
    expect(one({ quantity: "5" })).toBe(true);
    expect(one({ quantity: "0" })).toBe(false);
    expect(one({ quantity: "-1", expectedQuantity: "1" })).toBe(false);
    expect(one({ quantity: "abc" })).toBe(false);
  });

  it("setItems — под suppliers.manage, с замком и отказом для проведённого", () => {
    const router = read("api/arrival-router.ts");
    expect(router).toContain('setItems: operatorQuery.use(can("suppliers.manage"))');
    expect(router).toContain(".mutation(({ input, ctx }) => setArrivalItems(ctx.db, ctx.tenant.id, input.id, input.items))");
    const svc = read("api/services/arrival.ts");
    const at = svc.indexOf("export async function setArrivalItems(");
    const body = svc.slice(at, svc.indexOf("export async function updateArrival("));
    expect(body).toContain('.for("update")');
    expect(body).toContain('if (locked.status === "completed")');
    expect(body.indexOf('if (locked.status === "completed")')).toBeLessThan(body.indexOf("tx.delete(arrivalItems)"));
    expect(body).toContain("await assertItems(db, tenantId,");
  });

  it("проведение пропускает строки с нулём до движения остатка", () => {
    const svc = read("api/services/arrival.ts");
    const loop = svc.indexOf("for (const item of items) {\n        const qty = Number(item.quantity);");
    expect(loop).toBeGreaterThan(0);
    const skip = svc.indexOf("if (!(qty > 0)) continue;", loop);
    expect(skip).toBeGreaterThan(loop);
    expect(skip).toBeLessThan(svc.indexOf("await receiveStock(tx, {", loop));
  });

  it("товар дважды — отказ до обращения к базе", async () => {
    const { createArrival } = await import("../services/arrival");
    const db = new Proxy({}, { get: () => { throw new Error("к базе не ходили бы"); } });
    await expect(createArrival(db as never, 1, 1, {
      arrivalDate: "2026-09-24", fuelCost: "0", tollCost: "0", otherCost: "0",
      items: [{ productId: 7, quantity: "1" }, { productId: 7, quantity: "2" }],
    })).rejects.toThrow(/дважды/);
  });
});
