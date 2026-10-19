/**
 * Публичный API на настоящей MySQL: закупочной цены в ответах нет.
 *
 * Аудит 19.10.2026: /api/v1/products, /products/:id и позиции /orders/:id
 * отдавали интегратору costPrice — закупку и маржу дистрибьютора. Проверка —
 * сквозная: ключ, ворота с тарифом и подпиской, настоящие ручки и настоящие
 * строки, в которых закупочная цена есть.
 *
 * Страж исходников — api/__tests__/public-api-no-cost.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const RAW_KEY = "wp_live_" + "k".repeat(48);

describe.skipIf(!hasRealDb)("публичный API не отдаёт закупочную цену", () => {
  let db: ServiceDb;
  let s: Seeded;
  let orderId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    await db.update(schema.tenants).set({ plan: "exclusive" } as never).where(eq(schema.tenants.id, s.tenantId));
    await db.insert(schema.subscriptions).values({
      id: `sub_${s.tenantId}`, tenantId: s.tenantId, plan: "exclusive", status: "active",
      currentPeriodEnds: new Date(Date.now() + 30 * 86_400_000),
    } as never);
    await db.insert(schema.apiKeys).values({
      tenantId: s.tenantId, name: "integrator", keyHash: createHash("sha256").update(RAW_KEY).digest("hex"),
      keyPrefix: RAW_KEY.slice(0, 12), scopes: "products,orders", rateLimit: 600,
    } as never);
    await db.update(schema.products).set({ costPrice: "61.50" } as never).where(eq(schema.products.id, s.productId));
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, shopId: s.shopId, agentId: s.agentId, orderNumber: "№API-1",
      status: "delivered", paymentMethod: "cash", subtotal: "100.00", total: "100.00",
    } as never);
    orderId = Number(o.insertId);
    await db.insert(schema.orderItems).values({
      orderId, productId: s.productId, quantity: "1.00", unitPrice: "100.00", costPrice: "61.50", subtotal: "100.00",
    } as never);
  });

  const get = async (path: string) => {
    const app = (await import("../../public-api")).default;
    const r = await app.request(path, { headers: { authorization: `Bearer ${RAW_KEY}` } });
    expect(r.status, `${path}: ${await r.clone().text()}`).toBe(200);
    return r.text();
  };

  it("/products — цена продажи есть, закупочной нет", async () => {
    const body = await get("/products");
    expect(body).toContain("\"unitPrice\"");
    expect(body).not.toContain("costPrice");
    expect(body).not.toContain("61.5");
  });

  it("/products/:id — то же", async () => {
    const body = await get(`/products/${s.productId}`);
    expect(body).toContain("\"unitPrice\"");
    expect(body).not.toContain("costPrice");
  });

  it("/orders/:id — позиции без закупочной цены, форма строки прежняя", async () => {
    const body = await get(`/orders/${orderId}`);
    expect(body).not.toContain("costPrice");
    expect(body).not.toContain("61.5");
    const items = JSON.parse(body).data.items as Array<{ order_items: { unitPrice: string; quantity: string }; orders: { id: number } }>;
    expect(items).toHaveLength(1);
    expect(items[0].order_items).toMatchObject({ unitPrice: "100.00", quantity: "1.00" });
    expect(items[0].orders.id).toBe(orderId);
  });
});
