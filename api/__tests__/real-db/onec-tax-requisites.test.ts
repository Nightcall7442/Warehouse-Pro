/**
 * 1С получает ИНН контрагента и ставку НДС строки из карточек Warehouse Pro.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Контрагент заводился в 1С без ИНН и сопоставлялся только по названию: у
 * двух юрлиц с одной вывеской точка связывалась с первым попавшимся, а
 * бухгалтер дописывал ИНН каждому новому магазину руками. Каждая строка
 * реализации уходила со ставкой пресета (12 %), в том числе товар без НДС.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1С — эмулятор OData (helpers/fake-onec.ts), база — настоящая MySQL:
 *   • сверка: точка с ИНН находит контрагента по ИНН под другим названием;
 *     одноимённый контрагент с ДРУГИМ ИНН не подбирается; точка без ИНН —
 *     по названию, как раньше;
 *   • «Создать в 1С»: ИНН юрлица уходит в поле ИНН; ПИНФЛ туда не идёт;
 *     контрагент с тем же ИНН уже есть — связь с ним, без дубля;
 *   • реализация: «НДС 12%» — НДС12 и СуммаНДС; «без НДС» — СуммаНДС 0 и
 *     без выдуманной ставки; ставка задана в своей конфигурации — уходит она;
 *     товар без ставки — как раньше.
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
import { syncCounterparties, createCounterpartyFor } from "../../services/onec-counterparties";
import { clearBridgeCache } from "../../lib/onec-bridge";

const N = PRESETS.bp_uz;

describe.skipIf(!hasRealDb)("1С: ИНН контрагента и НДС строки", () => {
  let db: ServiceDb;
  let s: Seeded;
  let onec: FakeOneC;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });

  async function connect(nameOverrides: Record<string, unknown> | null = null) {
    const org = onec.add(N.organizations.set, { Description: "ООО Ромашка" });
    const wh = onec.add(N.warehouses.set, { Description: "Основной" });
    const pt = onec.add(N.priceTypes.set, { Description: "Оптовая" });
    await db.insert(schema.onecConfig).values({
      tenantId: s.tenantId, url: "http://onec.example.test/base", username: "odata", password: seal("secret"),
      preset: "bp_uz", organizationKey: String(org.Ref_Key), warehouseKey: String(wh.Ref_Key), priceTypeKey: String(pt.Ref_Key),
      enabled: true, intervalMinutes: 5, nameOverrides,
    });
  }

  beforeEach(async () => {
    await truncateAll();
    clearBridgeCache();
    s = await seed("10.000");
    onec = new FakeOneC();
    fake.current = onec;
  });

  const mappedTo = async (shopId: number) =>
    (await db.select().from(schema.idMappings).where(and(eq(schema.idMappings.entityType, "shop"), eq(schema.idMappings.internalId, shopId))))[0]?.externalId ?? null;
  const addShop = async (name: string, taxId: string | null) =>
    Number((await db.insert(schema.shops).values({ tenantId: s.tenantId, name, taxId }))[0].insertId);
  const counterpartyPosts = () => onec.requests.filter(r => r.method === "POST" && r.path === N.counterparties.set);

  it("сверка: по ИНН под другим названием; чужой ИНН под той же вывеской — нет; без ИНН — по названию", async () => {
    await connect();
    await db.update(schema.shops).set({ taxId: "301111111" }).where(eq(schema.shops.id, s.shopId)); // «Магазин Альфа»
    const byInn = onec.add(N.counterparties.set, { Description: "ООО ALFA SAVDO", ИНН: "301111111" });
    onec.add(N.counterparties.set, { Description: "Магазин Альфа", ИНН: "309999999" }); // та же вывеска, другое юрлицо
    const beta = await addShop("Бета", "302222222");
    onec.add(N.counterparties.set, { Description: "Бета", ИНН: "308888888" });
    const gamma = await addShop("Гамма", null);
    const gammaCp = onec.add(N.counterparties.set, { Description: "Гамма", ИНН: "307777777" });

    const r = await syncCounterparties(s.tenantId);
    expect(r).toMatchObject({ matched: 2, unmatched: 1 });
    expect(await mappedTo(s.shopId)).toBe(byInn.Ref_Key);
    expect(await mappedTo(beta)).toBeNull();
    expect(await mappedTo(gamma)).toBe(gammaCp.Ref_Key);
  });

  it("«Создать в 1С»: ИНН уходит в поле ИНН, ПИНФЛ — нет; существующий по ИНН — связь без дубля", async () => {
    await connect();
    const legal = await addShop("ООО Дельта", "303333333");
    const person = await addShop("ИП Эпсилон", "31234567890123");
    const known = onec.add(N.counterparties.set, { Description: "DELTA MChJ", ИНН: "304444444" });
    const again = await addShop("Дельта-2", "304444444");

    const a = await createCounterpartyFor(s.tenantId, legal);
    expect(counterpartyPosts().at(-1)?.body).toEqual({ Description: "ООО Дельта", ИНН: "303333333" });
    expect(onec.rows(N.counterparties.set).find(c => c.Ref_Key === a.externalId)).toMatchObject({ ИНН: "303333333" });

    await createCounterpartyFor(s.tenantId, person);
    expect(counterpartyPosts().at(-1)?.body).toEqual({ Description: "ИП Эпсилон" });

    const posts = counterpartyPosts().length;
    expect(await createCounterpartyFor(s.tenantId, again)).toEqual({ externalId: known.Ref_Key });
    expect(counterpartyPosts()).toHaveLength(posts);
    expect(await mappedTo(again)).toBe(known.Ref_Key);
  });

  async function exportOrder(): Promise<Array<Record<string, unknown>>> {
    const cp = onec.add(N.counterparties.set, { Description: "Магазин Альфа" });
    await db.insert(schema.idMappings).values({ tenantId: s.tenantId, entityType: "shop", externalId: String(cp.Ref_Key), internalId: s.shopId });
    for (const pid of [s.productId, s.secondProductId]) {
      const item = onec.add(N.nomenclature.set, { Description: `Товар ${pid}`, Артикул: `P-${pid}` });
      await db.insert(schema.idMappings).values({ tenantId: s.tenantId, entityType: "product", externalId: String(item.Ref_Key), internalId: pid });
    }
    const [o] = await db.insert(schema.orders).values({
      tenantId: s.tenantId, orderNumber: "ORD-VAT", shopId: s.shopId, agentId: s.agentId, status: "delivered",
      subtotal: "550.00", total: "550.00", deliveredAt: new Date(), deliveryStatus: "delivered",
    });
    const orderId = Number(o.insertId);
    await db.insert(schema.orderItems).values([
      { orderId, productId: s.productId, quantity: "3.00", unitPrice: "100.00", subtotal: "300.00" },
      { orderId, productId: s.secondProductId, quantity: "1.00", unitPrice: "250.00", subtotal: "250.00" },
    ]);
    await oneCSync.syncOrderTo1C(s.tenantId, orderId);
    const [doc] = onec.rows(N.sale.set);
    return doc.Товары as Array<Record<string, unknown>>;
  }

  it("реализация: 12 % — НДС12 и налог из цены; «без НДС» — сумма 0 и без выдуманной ставки; без ставки — как раньше", async () => {
    await connect();
    await db.update(schema.products).set({ vatRate: "exempt" }).where(eq(schema.products.id, s.productId));
    let lines = await exportOrder();
    expect(lines[0]).toMatchObject({ Сумма: 300, СуммаНДС: 0 });
    expect(lines[0]).not.toHaveProperty("СтавкаНДС");
    // Второй товар без ставки — ставка пресета, как было всегда.
    expect(lines[1]).toMatchObject({ Сумма: 250, СтавкаНДС: "НДС12", СуммаНДС: 26.79 });

    await truncateAll(); clearBridgeCache(); s = await seed("10.000"); onec = new FakeOneC(); fake.current = onec;
    await connect();
    await db.update(schema.products).set({ vatRate: "vat12" }).where(eq(schema.products.id, s.productId));
    await db.update(schema.products).set({ vatRate: "vat0" }).where(eq(schema.products.id, s.secondProductId));
    lines = await exportOrder();
    expect(lines[0]).toMatchObject({ Сумма: 300, СтавкаНДС: "НДС12", СуммаНДС: 32.14 });
    expect(lines[1]).toMatchObject({ Сумма: 250, СуммаНДС: 0 });
    expect(lines[1]).not.toHaveProperty("СтавкаНДС");
  });

  it("реализация: значение «без НДС», сверенное и заданное в своей конфигурации, уходит в СтавкаНДС", async () => {
    await connect({ sale: { vatRateExemptValue: "БезНДС" } });
    await db.update(schema.products).set({ vatRate: "exempt" }).where(eq(schema.products.id, s.productId));
    const lines = await exportOrder();
    expect(lines[0]).toMatchObject({ СтавкаНДС: "БезНДС", СуммаНДС: 0 });
  });
});
