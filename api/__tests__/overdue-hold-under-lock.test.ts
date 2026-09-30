/**
 * Просрочка проверяется под замком магазина, полевым — да, офису — нет.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Проверки просрочки не было вовсе. Кредитный лимит читает долг под замком
 * строки магазина (select … for update): иначе два заказа, оформленные
 * одновременно, видели долг до друг друга. Просрочку легко было бы
 * посчитать в роутере, до сделки, — и она читала бы долг, который уже
 * меняет соседняя оплата или доставка.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. В службе создания проверка стоит ПОСЛЕ замка строки магазина и ДО
 *    вставки заказа, а статус и причина берутся из её итога.
 * 2. Роутер просит проверку для всех, кроме офиса (ceo, operator) — тех, кто
 *    снимает ожидание, — и уведомляет офис итоговой причиной от службы.
 * 3. Веб-очередь без связи считает ответ «ждёт офиса» успехом: заказ уходит
 *    из очереди, а не копится ошибкой (ответ не разбирается на held).
 *
 * Нарочная поломка: перенести вызов overdueHold(tx, …) выше строки с
 * `.for("update")` у shopLocked — падает первая проверка.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", "..", p), "utf-8");

describe("просрочка под замком магазина", () => {
  it("проверка — после замка магазина и до вставки заказа; статус из её итога", () => {
    const svc = read("api/services/order-create.ts");
    const lockStart = svc.indexOf("const [shopLocked] = await tx.select(");
    const lock = svc.indexOf('.for("update")', lockStart);
    const check = svc.indexOf("await overdueHold(tx, tenantId, input.shopId)");
    const insert = svc.indexOf("await tx.insert(orders).values(");
    expect(lockStart, "замок строки магазина пропал").toBeGreaterThan(0);
    expect(lock - lockStart, "замок не у строки магазина").toBeLessThan(250);
    expect(check, "проверка просрочки пропала").toBeGreaterThan(lock);
    expect(check, "проверка после вставки заказа — поздно").toBeLessThan(insert);
    expect(svc).toContain('status: txHold ? "pending" : "new"');
    expect(svc).toContain("holdReason: txHold,");
  });

  it("полевым — проверка, офису — нет; офис узнаёт итоговую причину", () => {
    const router = read("api/order-router.ts");
    const create = router.slice(router.indexOf("create: fieldSalesQuery"), router.indexOf("cancel: fieldSalesQuery"));
    expect(create).toContain('checkOverdueDebt: !["ceo", "operator"].includes(ctx.user.role),');
    expect(create).toContain("if (heldFor && !created.idempotent) {");
    expect(create).toContain('uz: `${ctx.user.name}: ${holdReasonText(heldFor, "uz")}.');
  });

  it("веб-очередь без связи: «ждёт офиса» — успех, заказ уходит из очереди", () => {
    const sync = read("src/hooks/useOfflineSync.ts");
    const call = sync.indexOf("await createOrder.mutateAsync({");
    const drop = sync.indexOf("await deletePendingOrder(order.localId);", call);
    expect(call).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(call);
    // Между отправкой и удалением из очереди ответ не разбирается: удержанный
    // заказ создан, и повторять его нечего.
    expect(sync.slice(call, drop)).not.toMatch(/\bheld\b/);
  });
});
