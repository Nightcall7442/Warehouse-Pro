/**
 * GPS-точки не живут вечно и удаляются пачками.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Ни одной уборки agent_locations в планировщике; индекс (tenant_id,
 * agent_id) без времени — след за день читал всю историю агента. См. шапку
 * services/location-retention.ts.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Работа стоит в расписании ПОСЛЕ ночной копии.
 * 2. Уборка идёт пачками и останавливается на неполной пачке: 25 000 строк —
 *    три DELETE, не один и не бесконечно.
 * 3. Индекс на agent_locations начинается с tenant_id, agent_id, created_at,
 *    а миграция создаёт новый ДО удаления старого.
 *
 * Нарочная поломка: убери `.limit(BATCH)` из DELETE — вторая проверка
 * падает (один запрос вместо трёх).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const calls: number[] = [];
let remaining = 25_000;
vi.mock("../queries/connection", () => ({
  getDb: () => ({
    delete: () => ({
      where: () => ({
        limit: async (n: number) => {
          const affected = Math.min(n, remaining);
          remaining -= affected;
          calls.push(affected);
          return { affectedRows: affected };
        },
      }),
    }),
  }),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { purgeOldLocations, LOCATION_RETENTION_DAYS } = await import("../services/location-retention");
const { _internals } = await import("../cron/scheduler");

describe("уборка GPS-точек", () => {
  it("стоит в расписании после ночной копии", () => {
    const job = _internals.JOBS.find(j => j.name === "agent-locations-cleanup")!;
    const backup = _internals.JOBS.find(j => j.name === "backup")!;
    expect(job).toBeDefined();
    const minutes = (j: typeof job) => j.daily!.hour * 60 + j.daily!.minute;
    expect(minutes(job)).toBeGreaterThan(minutes(backup));
  });

  it("удаляет пачками и останавливается на неполной", async () => {
    const r = await purgeOldLocations(LOCATION_RETENTION_DAYS);
    expect(calls).toEqual([10_000, 10_000, 5_000]);
    expect(r).toEqual({ deleted: 25_000, batches: 3 });
    expect(LOCATION_RETENTION_DAYS).toBe(90);
  });

  it("индекс со временем есть, миграция создаёт новый до удаления старого", () => {
    const schema = readFileSync(resolve(__dirname, "../../db/schema.ts"), "utf-8");
    expect(schema).toContain('index("idx_locations_tenant_agent_created").on(t.tenantId, t.agentId, t.createdAt)');
    const sqlText = readFileSync(resolve(__dirname, "../../db/migrations/0022_agent_locations_index.sql"), "utf-8");
    expect(sqlText.indexOf("CREATE INDEX")).toBeGreaterThanOrEqual(0);
    expect(sqlText.indexOf("CREATE INDEX")).toBeLessThan(sqlText.indexOf("DROP INDEX"));
  });
});
