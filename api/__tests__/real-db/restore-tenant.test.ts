/**
 * Удалённая организация возвращается из копии — целиком и только она.
 *
 * Путь как в бою (scripts/restore-tenant.mjs): снять копию db-dump → стереть
 * организацию (tenant-offboard) → соседу за это время добавить заказ →
 * развернуть копию в черновую базу → перенести строки организации.
 * Проверяется: проба (commit=false) ничего не пишет; запись возвращает
 * столько же строк по каждой таблице, сколько было; соседа не трогает;
 * повторный запуск отказывает.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Выгрузка читает DATABASE_URL при загрузке модуля env — до импортов ниже.
vi.hoisted(() => { if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; });
import { gunzipSync } from "node:zlib";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { hasRealDb, connectRealDb, closeRealDb, truncateAll, seed, countOf, TEST_DATABASE_URL, type ServiceDb, type Seeded } from "./harness";
import { OrderService } from "../../services/order";
import { offboardTenant, countTenantRows } from "../../services/tenant-offboard";
// @ts-expect-error — скрипт на чистом JS, без объявлений типов.
import { copyTenant, fixTenantDates, splitStatements } from "../../../scripts/restore-tenant.mjs";

describe.skipIf(!hasRealDb)("восстановление удалённой организации из копии", () => {
  let db: ServiceDb;
  let s: Seeded;
  let conn: mysql.Connection;
  const target = new URL(TEST_DATABASE_URL || "mysql://x/x").pathname.slice(1);
  const source = `${target}_restore_tenant`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await connectRealDb();
    await truncateAll();
    s = await seed("10.000");
    await OrderService.create(db, s.tenantId, s.agentId, { shopId: s.shopId, paymentMethod: "debt", items: [{ productId: s.productId, quantity: "2" }] });
    conn = await mysql.createConnection({ uri: TEST_DATABASE_URL });
    // Даты из прошлого — их нельзя спутать с моментом восстановления.
    await conn.query(`UPDATE orders SET created_at = '2026-11-10 08:30:00' WHERE tenant_id = ?`, [s.tenantId]);
    await conn.query(`UPDATE users SET lastSignInAt = '2026-11-12 09:00:00' WHERE tenant_id = ?`, [s.tenantId]);
    await conn.query(`UPDATE tenants SET created_at = '2026-01-05 10:00:00' WHERE id = ?`, [s.tenantId]);
  }, 180_000);
  afterAll(async () => {
    await conn?.query(`DROP DATABASE IF EXISTS \`${source}\``).catch(() => {});
    await conn?.end();
    await closeRealDb();
  });

  it("проба не пишет, запись возвращает всё, соседа не трогает, повтор — отказ", async () => {
    await (db as any).update(schema.tenants).set({ status: "suspended" }).where(sql`id = ${s.tenantId}`);
    const before = await countTenantRows(db, s.tenantId);
    expect(before.orders).toBe(1);

    // Копия до удаления.
    const { startDump } = await import("../../services/db-dump");
    const { stream } = await startDump();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const statements = splitStatements(gunzipSync(Buffer.concat(chunks)).toString("utf8"));

    await offboardTenant(db, s.tenantId);
    expect(await countOf("tenants", `id = ${s.tenantId}`)).toBe(0);
    // Жизнь после удаления: у соседа новый магазин.
    await (db as any).insert(schema.shops).values({ tenantId: s.otherTenantId, name: "Новая точка соседа" });
    const neighbourShops = await countOf("shops", `tenant_id = ${s.otherTenantId}`);

    await conn.query(`DROP DATABASE IF EXISTS \`${source}\``);
    await conn.query(`CREATE DATABASE \`${source}\` CHARACTER SET utf8mb4`);
    await conn.query(`USE \`${source}\``);
    for (const st of statements) await conn.query(st);
    await conn.query(`USE \`${target}\``);

    const plan = await copyTenant(conn, { source, target, tenantId: s.tenantId, commit: false });
    expect(plan.committed).toBe(false);
    expect(plan.copied.orders).toBe(1);
    expect(await countOf("tenants", `id = ${s.tenantId}`), "проба записала").toBe(0);

    const applied = await copyTenant(conn, { source, target, tenantId: s.tenantId, commit: true });
    expect(applied.committed).toBe(true);
    const after = await countTenantRows(db, s.tenantId);
    expect(after).toEqual(before);
    const [[t]] = await conn.query(`SELECT status FROM \`${target}\`.tenants WHERE id = ?`, [s.tenantId]) as any;
    expect(t.status).toBe("suspended");
    expect(await countOf("shops", `tenant_id = ${s.otherTenantId}`), "соседа задело").toBe(neighbourShops);

    await expect(copyTenant(conn, { source, target, tenantId: s.tenantId, commit: true })).rejects.toThrow(/уже есть/);

    // Даты — из копии, а не момент восстановления (DEFAULT_GENERATED-столбцы).
    const dates = async () => {
      const [[o]] = await conn.query(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS d FROM orders WHERE tenant_id = ? LIMIT 1`, [s.tenantId]) as any;
      const [[u]] = await conn.query(`SELECT DATE_FORMAT(MIN(lastSignInAt), '%Y-%m-%d %H:%i') AS d FROM users WHERE tenant_id = ?`, [s.tenantId]) as any;
      const [[t2]] = await conn.query(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS d FROM tenants WHERE id = ?`, [s.tenantId]) as any;
      return { order: o.d, user: u.d, tenant: t2.d };
    };
    const expected = { order: "2026-11-10 08:30", user: "2026-11-12 09:00", tenant: "2026-01-05 10:00" };
    expect(await dates(), "даты потерялись при переносе").toEqual(expected);

    // Починка дат после переноса, потерявшего их: проба не пишет, запись возвращает.
    await conn.query(`UPDATE orders SET created_at = NOW() WHERE tenant_id = ?`, [s.tenantId]);
    await conn.query(`UPDATE users SET lastSignInAt = NOW() WHERE tenant_id = ?`, [s.tenantId]);
    await conn.query(`UPDATE tenants SET created_at = NOW() WHERE id = ?`, [s.tenantId]);
    const dry = await fixTenantDates(conn, { source, target, tenantId: s.tenantId, commit: false });
    expect(dry.updated.orders).toBe(1);
    expect((await dates()).order).not.toBe(expected.order);
    await fixTenantDates(conn, { source, target, tenantId: s.tenantId, commit: true });
    expect(await dates()).toEqual(expected);
    expect(await countOf("shops", `tenant_id = ${s.otherTenantId}`), "соседа задело").toBe(neighbourShops);
  }, 180_000);
});
