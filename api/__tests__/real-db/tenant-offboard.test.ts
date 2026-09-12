import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";
import { OrderService } from "../../services/order";
import { offboardTenant, countTenantRows, TenantNotSuspendedError } from "../../services/tenant-offboard";

/**
 * Уход организации на настоящей базе: ключи restrict настоящие, порядок
 * удаления — тот, что в OFFBOARD_ORDER. Соседняя организация не тронута.
 */
describe.skipIf(!hasRealDb)("уход организации", () => {
  let db: ServiceDb;
  let s: Seeded;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed("10.000");
    // заказ с резервом и строками — чтобы были дети без tenant_id и остаток
    await OrderService.create(db, s.tenantId, s.agentId, {
      shopId: s.shopId, paymentMethod: "cash",
      items: [{ productId: s.productId, quantity: "2" }],
    });
    // соседняя организация: пользователь и магазин, которые обязаны остаться
    const d = db as any;
    await d.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Сосед", email: "n@other.local", passwordHash: "x", role: "operator" });
    await d.insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Чужая точка" });
  });

  it("активную не стирает; приостановленную стирает целиком, соседа не трогает", async () => {
    await expect(offboardTenant(db, s.tenantId)).rejects.toBeInstanceOf(TenantNotSuspendedError);
    expect(await countOf("orders", `tenant_id = ${s.tenantId}`)).toBe(1);

    await (db as any).update(schema.tenants).set({ status: "suspended" }).where(sql`id = ${s.tenantId}`);
    const before = await countTenantRows(db, s.tenantId);
    expect(before.orders).toBe(1);
    expect(before.order_items).toBe(1);
    expect(before.users).toBeGreaterThanOrEqual(2);

    const r = await offboardTenant(db, s.tenantId);
    expect(r.deleted.orders).toBe(1);
    expect(r.total).toBeGreaterThan(5);

    expect(await countOf("tenants", `id = ${s.tenantId}`)).toBe(0);
    for (const t of ["users", "shops", "products", "warehouses", "warehouse_stock", "stock_movements", "orders"]) {
      expect(await countOf(t, `tenant_id = ${s.tenantId}`), t).toBe(0);
    }
    expect(await countOf("order_items")).toBe(0);
    expect(await countTenantRows(db, s.tenantId)).toEqual({});

    expect(await countOf("tenants", `id = ${s.otherTenantId}`)).toBe(1);
    expect(await countOf("users", `tenant_id = ${s.otherTenantId}`)).toBe(1);
    expect(await countOf("shops", `tenant_id = ${s.otherTenantId}`)).toBe(1);
  });
});
