/**
 * Заказ «в долг» сверх кредитного лимита магазина отказывается у прилавка.
 *
 * Дебиторка — главный операционный риск дистрибьютора; система умела её
 * посчитать и состарить, но не остановить. Здесь на настоящей базе: долг
 * магазина выведен из доставленного долгового заказа, лимит задан, и новый
 * заказ «в долг» сверх лимита не создаётся; тот же заказ за наличные и тот же
 * магазин без лимита проходят.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import { recalcShopDebt } from "../../services/shop-debt";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("кредитный лимит магазина", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll(); s = await seed("1000.000");
    // Долг 800: доставленный долговой заказ.
    await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: "№D-1",
      status: "delivered" as never, paymentMethod: "debt" as never, subtotal: "800.00", total: "800.00",
    } as never);
    await db.transaction(tx => recalcShopDebt(tx, s.tenantId, s.shopId));
  });

  const order = (paymentMethod: "debt" | "cash", key: string) => OrderService.create(db, s.tenantId, s.agentId, {
    shopId: s.shopId, items: [{ productId: s.productId, quantity: "3" }], paymentMethod, idempotencyKey: key,
  });

  it("сверх лимита в долг — отказ с названием магазина и числами", async () => {
    await db.update(schema.shops).set({ creditLimit: "1000.00" }).where(eq(schema.shops.id, s.shopId));
    // 800 + 3 × 100 = 1100 > 1000
    await expect(order("debt", "cl-1")).rejects.toThrow(/Кредитный лимит магазина «Магазин Альфа» 1000 превышен: долг 800 \+ заказ 300/);
    expect(await countOf("orders", `idempotency_key = 'cl-1'`)).toBe(0);
  });

  it("в пределах лимита — проходит", async () => {
    await db.update(schema.shops).set({ creditLimit: "1100.00" }).where(eq(schema.shops.id, s.shopId));
    await expect(order("debt", "cl-2")).resolves.toBeTruthy();
  });

  it("за наличные лимит не смотрится; без лимита — как раньше", async () => {
    await db.update(schema.shops).set({ creditLimit: "100.00" }).where(eq(schema.shops.id, s.shopId));
    await expect(order("cash", "cl-3")).resolves.toBeTruthy();
    await db.update(schema.shops).set({ creditLimit: null }).where(eq(schema.shops.id, s.shopId));
    await expect(order("debt", "cl-4")).resolves.toBeTruthy();
  });
});
