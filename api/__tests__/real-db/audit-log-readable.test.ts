import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, type ServiceDb, type Seeded } from "./harness";
import { recordAudit, getAuditLog, auditActors, exportAuditCsv } from "../../services/audit-log";

/**
 * Журнал действий на настоящей базе: подпись объекта пишется при записи и
 * достраивается при чтении для старых строк; отбор по слову, человеку,
 * периоду и виду объекта — тем SQL, который пойдёт в бой.
 */
describe.skipIf(!hasRealDb)("журнал действий: читаемый и с отбором", () => {
  let db: ServiceDb;
  let s: Seeded;
  let orderId: number;

  beforeAll(async () => { db = await connectRealDb(); }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [o] = await db.insert(schema.orders).values({ tenantId: s.tenantId, orderNumber: "ORD-0123", shopId: s.shopId, agentId: s.agentId, subtotal: "300.00", total: "300.00" });
    orderId = Number(o.insertId);
  });

  it("подпись объекта берётся в момент записи: номер заказа и магазин, имя товара, имя сотрудника", async () => {
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "order.create", targetType: "order", targetId: orderId, meta: { total: 300 } });
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "product.updated", targetType: "product", targetId: s.productId });
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "user.updated", targetType: "user", targetId: s.courierId });
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "settings.updated", targetType: "settings", targetId: 1 });

    const { data } = await getAuditLog(db as never, s.tenantId);
    const byAction = Object.fromEntries(data.map(r => [r.action, r.targetLabel]));
    expect(byAction["order.create"]).toBe("ORD-0123 · Магазин Альфа");
    expect(byAction["product.updated"]).toBe("Товар (P-1)");
    expect(byAction["user.updated"]).toBe("Курьер");
    expect(byAction["settings.updated"]).toBeNull(); // человеческого имени у настроек нет
  });

  it("старая строка без подписи получает её при чтении", async () => {
    await db.insert(schema.auditLog).values({ tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "order.cancelled", targetType: "order", targetId: orderId, targetLabel: null });
    const { data } = await getAuditLog(db as never, s.tenantId);
    expect(data[0].targetLabel).toBe("ORD-0123 · Магазин Альфа");
  });

  it("поиск по слову: имя магазина, номер заказа, сотрудник, подробности; служебные знаки LIKE гасятся", async () => {
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "order.create", targetType: "order", targetId: orderId });
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.courierId, actorName: "Курьер", action: "order.payment_recorded", targetType: "order", targetId: orderId, meta: { method: "cash", amount: 300 } });
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "settings.updated", targetType: "settings", targetId: 1 });
    // Соседняя организация с тем же словом — не видна.
    await db.insert(schema.auditLog).values({ tenantId: s.otherTenantId, actorName: "Агент", action: "order.create", targetLabel: "ORD-0123 · Магазин Альфа" });

    expect((await getAuditLog(db as never, s.tenantId, { search: "Альфа" })).total).toBe(2);
    expect((await getAuditLog(db as never, s.tenantId, { search: "ord-0123" })).total).toBe(2);
    expect((await getAuditLog(db as never, s.tenantId, { search: "Курьер" })).total).toBe(1);
    expect((await getAuditLog(db as never, s.tenantId, { search: "cash" })).total).toBe(1);
    expect((await getAuditLog(db as never, s.tenantId, { search: "%" })).total).toBe(3);   // не «всё подряд по маске», а пустое слово
    expect((await getAuditLog(db as never, s.tenantId, { search: "нет такого" })).total).toBe(0);
  });

  it("отбор по человеку, виду объекта и периоду; список людей — без чужих", async () => {
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "order.create", targetType: "order", targetId: orderId });
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.courierId, actorName: "Курьер", action: "user.updated", targetType: "user", targetId: s.agentId });
    await db.insert(schema.auditLog).values({ tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "order.cancelled", targetType: "order", targetId: orderId, createdAt: new Date("2026-01-10T10:00:00Z") });
    await db.insert(schema.auditLog).values({ tenantId: s.otherTenantId, actorId: s.courierId, actorName: "Чужой", action: "order.create" });

    expect((await getAuditLog(db as never, s.tenantId, { actorId: s.courierId })).total).toBe(1);
    expect((await getAuditLog(db as never, s.tenantId, { targetType: "order" })).total).toBe(2);
    expect((await getAuditLog(db as never, s.tenantId, { dateFrom: "2026-06-01T00:00:00Z" })).total).toBe(2);
    expect((await getAuditLog(db as never, s.tenantId, { dateFrom: "2026-01-01T00:00:00Z", dateTo: "2026-01-31T23:59:59Z" })).total).toBe(1);

    const actors = await auditActors(db as never, s.tenantId);
    expect(actors.map(a => a.name).sort()).toEqual(["Агент", "Курьер"]);
  });

  it("CSV несёт подпись объекта, а не только тип и номер строки", async () => {
    await recordAudit(db as never, { tenantId: s.tenantId, actorId: s.agentId, actorName: "Агент", action: "order.create", targetType: "order", targetId: orderId });
    const { data } = await getAuditLog(db as never, s.tenantId);
    const csv = exportAuditCsv(data);
    expect(csv.split("\n")[0]).toContain("Объект");
    expect(csv).toContain('"ORD-0123 · Магазин Альфа"');
  });
});
