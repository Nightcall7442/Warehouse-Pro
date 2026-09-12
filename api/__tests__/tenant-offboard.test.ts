/**
 * Уход организации: список таблиц полон и упорядочен, замки стоят на сервере.
 *
 * Порядок удаления в services/tenant-offboard.ts — руками. Страж читает
 * db/schema.ts и проверяет три вещи: каждая таблица с tenant_id есть в
 * списке; каждая таблица без tenant_id, но с ключом на таблицу арендатора,
 * стирается через родителя; ни одна таблица не удаляется раньше тех, кто на
 * неё ссылается. Новая таблица со схемой, забытая в списке, роняет тест — а
 * не оставляет сироту в бою.
 *
 * Нарочная поломка: убери "payments" из OFFBOARD_ORDER — первый тест назовёт
 * его; поменяй местами "orders" и "payments" — третий покажет, кто на кого
 * ссылается.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { OFFBOARD_ORDER, NOT_TENANT_OWNED, offboardTenant, TenantNotSuspendedError } from "../services/tenant-offboard";

const schema = readFileSync("db/schema.ts", "utf8").replace(/\r\n/g, "\n");

interface Table { name: string; tenant: boolean; refs: { column: string; parent: string }[] }

/** Таблицы из db/schema.ts: имя, есть ли tenant_id, внешние ключи (по имени переменной). */
function parseTables(): Table[] {
  const parts = schema.split(/\nexport const (\w+)\s*=\s*mysqlTable\("(\w+)"/);
  const byVar = new Map<string, string>();
  const raw: { var: string; name: string; body: string }[] = [];
  for (let i = 1; i < parts.length; i += 3) {
    const body = parts[i + 2];
    const end = body.indexOf("\n});");
    raw.push({ var: parts[i], name: parts[i + 1], body: end > 0 ? body.slice(0, end) : body });
    byVar.set(parts[i], parts[i + 1]);
  }
  return raw.map(t => ({
    name: t.name,
    tenant: t.body.includes('"tenant_id"'),
    refs: [...t.body.matchAll(/\w+:\s*\w+\("(\w+)"[^\n]*?references\(\(\)\s*=>\s*(\w+)\.\w+/g)]
      .map(m => ({ column: m[1], parent: byVar.get(m[2]) ?? m[2] }))
      .filter(r => r.parent !== "tenants" && r.parent !== t.name),
  }));
}

const tables = parseTables();
const tableOf = (s: (typeof OFFBOARD_ORDER)[number]) => (typeof s === "string" ? s : s.table);
const listed = OFFBOARD_ORDER.map(tableOf);

describe("список таблиц ухода организации", () => {
  it("каждая таблица с tenant_id стирается, кроме самой tenants", () => {
    const withTenant = tables.filter(t => t.tenant).map(t => t.name);
    expect(withTenant.length).toBeGreaterThan(40);
    const missing = withTenant.filter(n => !listed.includes(n));
    expect(missing, "таблицы с tenant_id, которых нет в OFFBOARD_ORDER").toEqual([]);
  });

  it("таблица без tenant_id, но с ключом на таблицу арендатора, стирается через родителя", () => {
    for (const t of tables) {
      if (t.tenant || (NOT_TENANT_OWNED as readonly string[]).includes(t.name)) continue;
      const step = OFFBOARD_ORDER.find(s => typeof s !== "string" && s.table === t.name);
      expect(step, `${t.name} без tenant_id должна стираться через родителя`).toBeDefined();
      if (typeof step === "string" || !step) continue;
      // родитель — одна из её ссылок, и ссылка ведёт в таблицу арендатора
      const ref = t.refs.find(r => r.column === step.via.column && r.parent === step.via.parent);
      expect(ref, `${t.name}: via ${step.via.column} → ${step.via.parent} не совпадает со схемой`).toBeDefined();
      expect(tables.find(x => x.name === step.via.parent)?.tenant, `${step.via.parent} без tenant_id`).toBe(true);
    }
  });

  it("никто не удаляется раньше тех, кто на него ссылается (ключи restrict)", () => {
    const pos = new Map(listed.map((n, i) => [n, i]));
    const violations: string[] = [];
    for (const t of tables) {
      if (!pos.has(t.name)) continue;
      for (const r of t.refs) {
        if (!pos.has(r.parent)) continue;
        if (pos.get(t.name)! > pos.get(r.parent)!) violations.push(`${t.name} → ${r.parent}`);
      }
    }
    expect(violations, "ребёнок стоит после родителя").toEqual([]);
    expect(listed.at(-1)).toBe("users");
    expect(new Set(listed).size).toBe(listed.length);
  });
});

describe("сама процедура", () => {
  it("активную организацию не стирает — откат до первой строки", async () => {
    const executed: string[] = [];
    const tx = { execute: vi.fn(async (q: { queryChunks?: unknown[] }) => {
      executed.push(JSON.stringify(q.queryChunks ?? "").slice(0, 60));
      return [[{ status: "active" }], []];
    }) };
    const db = { transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) } as never;
    await expect(offboardTenant(db, 7)).rejects.toBeInstanceOf(TenantNotSuspendedError);
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it("роутер: только suspended, только со slug и кодом второго фактора; экран зовёт обе ручки", () => {
    const router = readFileSync("api/tenant-router.ts", "utf8");
    const at = router.indexOf("offboard: superAdminQuery");
    const body = router.slice(at, router.indexOf("extendTrial: superAdminQuery", at));
    expect(body).toContain('if (t.status !== "suspended") throw new TRPCError({ code: "PRECONDITION_FAILED"');
    expect(body).toContain("if (input.confirmSlug.trim() !== t.slug)");
    expect(body).toContain("const step = await checkTotpStepUp(db, ctx.user.id, input.totpCode);");
    // и всё это — ДО вызова службы
    expect(body.indexOf("checkTotpStepUp(")).toBeLessThan(body.indexOf("await offboardTenant("));
    const ui = readFileSync("src/components/superadmin/TenantDetail.tsx", "utf8");
    expect(ui).toContain("trpc.tenant.offboardPreview.useQuery");
    expect(ui).toContain("trpc.tenant.offboard.useMutation");
    expect(ui).toContain('disabled={tenant.status !== "suspended"}');
  });

  it("выгрузка дампа и уход организации проверяют второй фактор одним помощником", () => {
    expect(readFileSync("api/http/backup.ts", "utf8")).toContain("checkTotpStepUp(getDb(), auth.user.id, c.req.header(\"x-totp-code\"))");
  });
});
