import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, type ServiceDb, type Seeded } from "./harness";

/**
 * Смена логина сотруднику организации из суперадмина — по просьбе клиента
 * (Velora: «хотим другую почту для входа»). Через настоящий tRPC-вызов:
 * ключ суперадмина, уникальность внутри организации, старые сессии гаснут,
 * почта владельца в карточке организации идёт следом, след в журнале.
 */
let current: ServiceDb;
vi.mock("../../queries/connection", () => ({ getDb: () => current, getPool: () => null }));

function ctxFor(db: ServiceDb, role: "superadmin" | "ceo", tenantId: number, userId: number): any {
  return {
    req: new Request("http://localhost/"), resHeaders: new Headers(), db,
    user: { id: userId, tenantId, role, status: "active" as const, name: role, email: `${role}@test.local`, passwordHash: "x", avatar: null, phone: null, createdAt: new Date(), updatedAt: new Date(), lastSignInAt: new Date() },
    tenant: { id: tenantId, slug: "test-co", name: "Тестовая компания", plan: "pro" as const, status: "active" as const, createdAt: new Date(), updatedAt: new Date() },
  };
}

describe.skipIf(!hasRealDb)("смена логина сотруднику из суперадмина", () => {
  let db: ServiceDb;
  let s: Seeded;
  let ceoId: number;
  let superId: number;

  beforeAll(async () => { db = await connectRealDb(); current = db; }, 180_000);
  afterAll(async () => { await closeRealDb(); });
  beforeEach(async () => {
    await truncateAll();
    s = await seed();
    const [ceo] = await db.insert(schema.users).values({ tenantId: s.tenantId, name: "Собиржон", email: "sobirjon@velora.uz", passwordHash: "x", role: "ceo", tokenVersion: 3 });
    ceoId = Number(ceo.insertId);
    await db.update(schema.tenants).set({ ownerEmail: "sobirjon@velora.uz" }).where(eq(schema.tenants.id, s.tenantId));
    // Суперадмин — настоящая строка users: журнал ссылается на actor_id внешним ключом.
    const [sa] = await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Владелец платформы", email: "root@platform.local", passwordHash: "x", role: "superadmin" });
    superId = Number(sa.insertId);
  });

  const asSuperadmin = async () => (await import("../../tenant-router")).tenantRouter.createCaller(ctxFor(db, "superadmin", s.otherTenantId, superId));

  it("меняет почту, гасит сессии, тянет за собой почту владельца, пишет след", async () => {
    const r = await (await asSuperadmin()).changeUserLogin({ tenantId: s.tenantId, userId: ceoId, email: "  Director@Velora.UZ " });
    expect(r).toEqual({ email: "director@velora.uz", unchanged: false });

    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, ceoId));
    expect(u.email).toBe("director@velora.uz");
    expect(u.tokenVersion).toBe(4);          // старая кука больше не подходит
    expect(u.passwordHash).toBe("x");        // пароль не трогали
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId));
    expect(t.ownerEmail).toBe("director@velora.uz");
    expect(await countOf("audit_log", `action = 'user.login_changed' AND target_id = ${ceoId}`)).toBe(1);
  });

  it("почта другого сотрудника той же организации — отказ; та же почта в соседней организации — можно", async () => {
    const sa = await asSuperadmin();
    await expect(sa.changeUserLogin({ tenantId: s.tenantId, userId: ceoId, email: "agent@test.local" })).rejects.toThrow(/уже есть/);
    await db.insert(schema.users).values({ tenantId: s.otherTenantId, name: "Сосед", email: "shared@mail.uz", passwordHash: "x", role: "ceo" });
    await expect(sa.changeUserLogin({ tenantId: s.tenantId, userId: ceoId, email: "shared@mail.uz" })).resolves.toMatchObject({ email: "shared@mail.uz" });
  });

  it("сотрудник не из этой организации — не найден; та же почта — без изменений и без следа", async () => {
    const sa = await asSuperadmin();
    await expect(sa.changeUserLogin({ tenantId: s.otherTenantId, userId: ceoId, email: "x@y.uz" })).rejects.toThrow(/не найден/);
    await expect(sa.changeUserLogin({ tenantId: s.tenantId, userId: ceoId, email: "sobirjon@velora.uz" })).resolves.toMatchObject({ unchanged: true });
    expect(await countOf("audit_log", "action = 'user.login_changed'")).toBe(0);
  });

  it("директор организации этой ручкой не владеет — у него свой путь («Передать доступ»)", async () => {
    const caller = (await import("../../tenant-router")).tenantRouter.createCaller(ctxFor(db, "ceo", s.tenantId, ceoId));
    await expect(caller.changeUserLogin({ tenantId: s.tenantId, userId: ceoId, email: "x@y.uz" })).rejects.toThrow();
  });
});
