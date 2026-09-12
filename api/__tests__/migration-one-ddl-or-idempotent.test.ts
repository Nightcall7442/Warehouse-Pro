/**
 * Правило миграций с 0028: файл — либо только DDL, либо одно идемпотентное
 * выражение с данными. Смешивать нельзя.
 *
 * ── Почему ─────────────────────────────────────────────────────────────────
 *
 * DDL в MySQL не откатывается. Файл из нескольких выражений, оборванный на
 * середине выкладкой (тайм-аут, перезапуск платформы), при следующем старте
 * падал на первом же выражении с «колонка уже есть» — и так на каждом старте,
 * навсегда; вручную его доводили в консоли. Теперь boot.ts на «уже есть» не
 * останавливается, а догон (migration-catchup) доводит файл, прощая сделанное.
 *
 * Но догон, простив первое «уже есть», перепись ДАННЫХ в том же файле
 * пропускает — иначе повтор задвоил бы строки. Значит, данные должны жить в
 * своём файле и быть идемпотентными: повтор после обрыва безопасен, а
 * пропускать их догону не за что.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isAlreadyThere } from "../lib/migration-catchup";
import { bootSource } from "./helpers/boot-source";

const RULE_FROM_IDX = 28;
const journal = JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf-8")) as { entries: Array<{ idx: number; tag: string }> };

const isDdl = (s: string) => /^\s*(CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i.test(s);
const isIdempotentDml = (s: string) => {
  if (/^\s*INSERT\b/i.test(s)) return /INSERT\s+IGNORE|ON\s+DUPLICATE\s+KEY|NOT\s+EXISTS/i.test(s);
  if (/^\s*(UPDATE|DELETE)\b/i.test(s)) return /\bWHERE\b/i.test(s) && !/=\s*\w+\s*[+\-*/]\s*\d/.test(s);
  return false;
};

describe("миграции с 0028: один DDL-файл или одно идемпотентное выражение", () => {
  const recent = journal.entries.filter(e => e.idx >= RULE_FROM_IDX);

  it("правило проверяет хотя бы одну миграцию", () => {
    expect(recent.length).toBeGreaterThan(0);
  });

  for (const entry of recent) {
    it(entry.tag, () => {
      const statements = readFileSync(`db/migrations/${entry.tag}.sql`, "utf-8")
        .split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
      const ddl = statements.filter(isDdl);
      const dml = statements.filter(s => !isDdl(s));
      if (dml.length === 0) return; // только схема — догон доведёт после обрыва
      expect(ddl, `${entry.tag}: данные и схема в одном файле — после обрыва догон пропустит данные`).toEqual([]);
      expect(dml, `${entry.tag}: перепись данных — одним выражением, чтобы обрыв не оставил половину`).toHaveLength(1);
      expect(isIdempotentDml(dml[0]), `${entry.tag}: выражение не идемпотентно (нужно NOT EXISTS / INSERT IGNORE / ON DUPLICATE KEY / UPDATE … WHERE без приращения)`).toBe(true);
    });
  }

  it("детектор идемпотентности отличает безопасное от опасного", () => {
    expect(isIdempotentDml("INSERT INTO t (a) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM t)")).toBe(true);
    expect(isIdempotentDml("INSERT INTO t (a) VALUES (1)")).toBe(false);
    expect(isIdempotentDml("UPDATE t SET a = 1 WHERE b IS NULL")).toBe(true);
    expect(isIdempotentDml("UPDATE t SET a = a + 1 WHERE b IS NULL")).toBe(false);
    expect(isIdempotentDml("UPDATE t SET a = 1")).toBe(false);
  });
});

describe("оборванный файл не глушит запуск навсегда", () => {
  it("boot: «уже есть» от штатного мигратора — предупреждение и догон, остальное — отказ", () => {
    const boot = bootSource();
    const block = boot.slice(boot.indexOf("await withMigrationLock("), boot.indexOf("caughtUp = await catchUpMigrations"));
    expect(block).toContain("if (!isAlreadyThere(e)) throw e;");
  });

  it("isAlreadyThere видит код сквозь обёртку drizzle", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("Duplicate column"), { errno: 1060 }) });
    expect(isAlreadyThere(wrapped)).toBe(true);
    expect(isAlreadyThere(Object.assign(new Error("Unknown column"), { errno: 1054 }))).toBe(false);
    expect(isAlreadyThere(new Error("plain"))).toBe(false);
  });
});
