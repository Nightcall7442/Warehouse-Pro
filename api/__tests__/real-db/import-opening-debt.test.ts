/**
 * Долг из импорта магазинов переживает оплату — на настоящей MySQL.
 *
 * Бизнес-аудит 19.11.2026: импорт писал долг числом в shops.debt, и первая
 * же оплата магазина (recalcShopDebt) делала его нулём. Теперь долг из файла —
 * строка «долг» без заказа; миграция 0073 переносит так же долги магазинов,
 * импортированных раньше и ещё не пересчитанных.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { ctxFor, hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { PaymentService } from "../../services/payment";
import { recalcShopDebt } from "../../services/shop-debt";

let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

const csv = (lines: string[]) => Buffer.from(lines.join("\n"), "utf-8").toString("base64");

describe.skipIf(!hasRealDb)("начальный долг из импорта", () => {
  let db: ServiceDb;
  let s: Seeded;
  let operatorId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [op] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Оператор", email: "op@test.local", passwordHash: "x", role: "operator" });
    operatorId = Number(op.insertId);
  });

  const shop = async (name: string) => (await db.select().from(schema.shops).where(eq(schema.shops.name, name)))[0];

  it("850 000 из файла после оплаты 100 000 — это 750 000, а не ноль", async () => {
    const api = (await import("../../import-router")).importRouter.createCaller(ctxFor(db, s.tenantId, operatorId, "operator"));
    const r = await api.executeImport({ type: "shops", filename: "s.csv", base64: csv([
      "Название;Телефон;Долг",
      "Барока Market;+998 91 100 00 02;850 000",
    ]) });
    expect(r.success).toBe(1);
    const imported = await shop("Барока Market");
    expect(imported.debt).toBe("850000.00");

    await PaymentService.addPayment(db, s.tenantId, { shopId: imported.id, amount: "100000", type: "payment", createdBy: operatorId });
    expect((await shop("Барока Market")).debt).toBe("750000.00");

    // Повторная загрузка того же файла не заводит магазин и долг заново.
    const again = await api.executeImport({ type: "shops", filename: "s.csv", base64: csv([
      "Название;Телефон;Долг",
      "Барока Market;+998 91 100 00 02;850 000",
    ]) });
    expect(again.success).toBe(0);
    expect((await shop("Барока Market")).debt).toBe("750000.00");
  });

  it("миграция 0073 записывает строкой долг, который записи не объясняют, и только его", async () => {
    // Импортирован прежним кодом: число на магазине, записей нет.
    const [old] = await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Старый импорт", debt: "850000.00" });
    // Долг уже записан как надо — трогать нечего.
    const [fine] = await db.insert(schema.shops).values({ tenantId: s.tenantId, name: "Как надо", debt: "50000.00" });
    await db.insert(schema.payments).values({ tenantId: s.tenantId, shopId: Number(fine.insertId), amount: "50000.00", type: "debt" });

    const migration = readFileSync("db/migrations/0073_preserve_imported_shop_debt.sql", "utf-8");
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration)); // повтор ничего не добавляет

    const rows = await db.select().from(schema.payments);
    const ofOld = rows.filter(p => p.shopId === Number(old.insertId));
    expect(ofOld).toHaveLength(1);
    expect(ofOld[0]).toMatchObject({ type: "debt", amount: "850000.00", orderId: null });
    expect(rows.filter(p => p.shopId === Number(fine.insertId))).toHaveLength(1);
    expect(rows.filter(p => p.shopId === s.shopId)).toHaveLength(0);

    // Пересчёт теперь сохраняет число, а не стирает его.
    await db.transaction(tx => recalcShopDebt(tx, s.tenantId, Number(old.insertId)));
    expect((await shop("Старый импорт")).debt).toBe("850000.00");
  });
});
