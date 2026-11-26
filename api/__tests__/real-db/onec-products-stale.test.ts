/**
 * Обмен товаров с 1С отключает только пропавшее из 1С — бизнес-аудит
 * 19.11.2026, п. 21.
 *
 * Товар, на строке которого обмен споткнулся (здесь — цена не число),
 * отключался как «удалённый из 1С» и оставался отключённым навсегда, а обмен
 * при этом считался успешным.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { FakeOneC } from "../helpers/fake-onec";
import { seal } from "../../lib/secret-box";
import { PRESETS } from "../../lib/onec-presets";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));
const { fake } = vi.hoisted(() => ({ fake: { current: null as null | { fetch: (u: string, i?: RequestInit) => Promise<Response> } } }));
vi.mock("../../lib/safe-fetch", () => ({ safeFetch: (u: string, i?: RequestInit) => fake.current!.fetch(u, i) }));

import { oneCSync } from "../../services/onec-sync";
import { clearBridgeCache } from "../../lib/onec-bridge";

const N = PRESETS.bp_uz;

describe.skipIf(!hasRealDb)("обмен товаров с 1С: что отключается", () => {
  let db: ServiceDb;
  let s: Seeded;
  let onec: FakeOneC;
  let goneId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  beforeEach(async () => {
    await truncateAll();
    clearBridgeCache();
    s = await seed("10.000");
    onec = new FakeOneC();
    fake.current = onec;
    const org = onec.add(N.organizations.set, { Description: "ООО Ромашка" });
    const wh = onec.add(N.warehouses.set, { Description: "Основной" });
    const pt = onec.add(N.priceTypes.set, { Description: "Оптовая" });
    await db.insert(schema.onecConfig).values({
      tenantId: s.tenantId, url: "http://onec.example.test/base", username: "odata", password: seal("secret"),
      preset: "bp_uz", organizationKey: String(org.Ref_Key), warehouseKey: String(wh.Ref_Key), priceTypeKey: String(pt.Ref_Key),
      enabled: true, intervalMinutes: 5, syncPayments: false,
    } as never);
    // Первый товар — в 1С, но с ценой «не число»: строка обмена упадёт.
    const broken = onec.add(N.nomenclature.set, { Description: "Сломанная цена", Code: "P-1", Артикул: "P-1" });
    onec.add(N.prices.set, { [N.prices.item]: broken.Ref_Key, [N.prices.type]: pt.Ref_Key, [N.prices.price]: "не число" });
    await db.insert(schema.idMappings).values({ tenantId: s.tenantId, entityType: "product", externalId: String(broken.Ref_Key), internalId: s.productId });
    // Второй — в 1С и в порядке.
    const fine = onec.add(N.nomenclature.set, { Description: "Второй товар", Code: "P-2", Артикул: "P-2" });
    await db.insert(schema.idMappings).values({ tenantId: s.tenantId, entityType: "product", externalId: String(fine.Ref_Key), internalId: s.secondProductId });
    // Третий связан с позицией, которой в 1С больше нет.
    const [p] = await db.insert(schema.products).values({ tenantId: s.tenantId, code: "P-3", name: "Удалён в 1С", unitPrice: "1.00" } as never);
    goneId = Number(p.insertId);
    await db.insert(schema.idMappings).values({ tenantId: s.tenantId, entityType: "product", externalId: "00000000-0000-0000-0000-0000000000ff", internalId: goneId });
  });

  const statusOf = async (id: number) =>
    (await db.select({ status: schema.products.status }).from(schema.products).where(eq(schema.products.id, id)))[0]?.status;

  it("товар с ошибкой остаётся активным, пропавший из 1С — отключается, обмен — не «успешен»", async () => {
    const r = await oneCSync.syncProducts(s.tenantId);
    expect(r.errors).toBe(1);
    expect(await statusOf(s.productId), "товар с ошибкой на строке отключён").toBe("active");
    expect(await statusOf(s.secondProductId)).toBe("active");
    expect(await statusOf(goneId)).toBe("inactive");
    const [st] = await db.select({ status: schema.syncStatus.status, lastError: schema.syncStatus.lastError }).from(schema.syncStatus)
      .where(and(eq(schema.syncStatus.tenantId, s.tenantId), eq(schema.syncStatus.entityType, "product")));
    expect(st.status).toBe("failed");
    expect(st.lastError).toMatch(/1 из 2 позиций/);
  });
});
