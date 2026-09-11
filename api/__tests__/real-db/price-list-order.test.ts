/**
 * Заказ на настоящей базе берёт цену из прайс-листа магазина.
 *
 * Заглушка отдаёт пустой список для любого JOIN, поэтому на ней прайс-лист
 * «не находится» всегда — и создание заказа по цене карточки выглядело бы
 * правильным. Здесь список настоящий: строка заказа получает цену списка,
 * помнит его id, а магазин без списка — цену карточки.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { OrderService } from "../../services/order";
import {
  hasRealDb, connectRealDb, closeRealDb, truncateAll, seed,
  type ServiceDb, type Seeded,
} from "./harness";

const describeIf = hasRealDb ? describe : describe.skip;

describeIf("прайс-лист магазина в заказе", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); });
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => { await truncateAll(); s = await seed("100.000"); });

  async function listFor(shopId: number, priority: number, tiers: Array<[string, string]>): Promise<number> {
    const [pl] = await db.insert(schema.priceLists).values({ tenantId: s.tenantId, name: `Список ${priority}`, priority, isActive: true } as never);
    const id = Number(pl.insertId);
    await db.insert(schema.priceListItems).values(tiers.map(([minQuantity, price]) => ({ priceListId: id, productId: s.productId, minQuantity, price })) as never);
    await db.insert(schema.priceListAssignments).values({ priceListId: id, shopId } as never);
    return id;
  }

  async function lineOf(orderId: number) {
    const [row] = await db.select({ unitPrice: schema.orderItems.unitPrice, priceListId: schema.orderItems.priceListId, subtotal: schema.orderItems.subtotal })
      .from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    return row!;
  }

  it("строка берёт цену списка и помнит его", async () => {
    const listId = await listFor(s.shopId, 0, [["1", "80.00"], ["10", "70.00"]]);
    const r = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, items: [{ productId: s.productId, quantity: "12" }], idempotencyKey: "pl-1",
    });
    const line = await lineOf(r.id);
    expect(line.unitPrice).toBe("70.00");   // ярус от 10 штук
    expect(line.subtotal).toBe("840.00");
    expect(Number(line.priceListId)).toBe(listId);
  });

  it("магазин без списка — цена карточки", async () => {
    const r = await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, items: [{ productId: s.productId, quantity: "2" }], idempotencyKey: "pl-2",
    });
    const line = await lineOf(r.id);
    expect(line.unitPrice).toBe("100.00");
    expect(line.priceListId).toBeNull();
  });
});
