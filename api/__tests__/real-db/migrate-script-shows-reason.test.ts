/**
 * Накат миграций с нуля в CI называет причину, когда падает.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В test-migrations стоял «временный отладочный» шаг debug-migrate.cjs с
 * пометкой «убрать, когда drizzle-kit migrate заработает сам». 29.09.2026 его
 * собрались убрать — и проверили: drizzle-kit 0.31.11 на сломанной миграции
 * выходит с кодом 1, не напечатав ничего, кроме «Reading config file». Его
 * счётчик ловит ошибку и гасит строку. Без этого шага красный накат в CI
 * выглядел бы как «exit code 1» без единой подробности.
 *
 * Шаг остался и стал главным: scripts/migrate.cjs — тот же migrate() из
 * drizzle-orm, что зовёт сервер при запуске. Причину он печатает первой
 * строкой с «Error:», и scripts/ci-run.sh выносит её в пометку, видную без
 * входа в GitHub.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * На черновой базе того же сервера, по-настоящему, отдельным процессом — как
 * в CI:
 *   1. вся цепочка db/migrations встаёт на пустую базу, код выхода 0;
 *   2. сломанная миграция даёт код 1, и первая строка ошибки называет и
 *      упавший запрос, и ответ MySQL.
 *
 * База стенда не трогается: черновая создаётся рядом и стирается. Успешный
 * накат в базу стенда был бы опасен — запись в журнале миграций с меткой
 * из будущего молча глушит все следующие.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import mysql from "mysql2/promise";
import { hasRealDb, TEST_DATABASE_URL } from "./harness";

const REPO = resolve(__dirname, "../../..");
const SCRIPT = join(REPO, "scripts", "migrate.cjs");

function scratchUrl(name: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

function runMigrate(cwd: string, databaseUrl: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 110_000,
  });
}

describe("test-migrations накатывает с нуля этим скриптом", () => {
  it("первый накат — scripts/migrate.cjs, drizzle-kit — только после", () => {
    // Дополнение к проверкам ниже: без этого шаг легко снова принять за
    // временный и убрать, а накат с нуля отдать drizzle-kit, который молчит.
    const wf = readFileSync(join(REPO, ".github/workflows/test-migrations.yml"), "utf8");
    const script = wf.indexOf("node scripts/migrate.cjs");
    const kit = wf.indexOf("npx drizzle-kit migrate");
    expect(script, "накат с нуля больше не идёт через scripts/migrate.cjs").toBeGreaterThan(0);
    expect(kit, "drizzle-kit накатывает раньше скрипта — скрипту остаётся пустая работа").toBeGreaterThan(script);
  });
});

describe.skipIf(!hasRealDb)("накат миграций с нуля — scripts/migrate.cjs", () => {
  const base = new URL(TEST_DATABASE_URL || "mysql://x/x").pathname.slice(1);
  const scratch = `${base}_migrate_probe`;
  let server: mysql.Connection;
  let tmp = "";

  async function freshScratch() {
    await server.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
    await server.query(`CREATE DATABASE \`${scratch}\``);
  }

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = "/";
    server = await mysql.createConnection(url.toString());
    tmp = mkdtempSync(join(tmpdir(), "migrate-probe-"));
  });

  afterAll(async () => {
    await server?.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
    await server?.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("вся цепочка встаёт на пустую базу", async () => {
    await freshScratch();
    const r = runMigrate(REPO, scratchUrl(scratch));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Миграции применены.");

    const [rows] = await server.query(
      `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`, [scratch],
    ) as unknown as [Array<{ t: string }>];
    const tables = rows.map(r => r.t);
    expect(tables).toContain("orders");
    expect(tables).toContain("warehouse_stock");
    expect(tables).toContain("__drizzle_migrations");
  }, 120_000);

  it("сломанная миграция: код 1 и причина первой строкой", async () => {
    await freshScratch();
    // Отдельная папка миграций из одного файла — рабочие не трогаем.
    const folder = join(tmp, "db", "migrations");
    mkdirSync(join(folder, "meta"), { recursive: true });
    writeFileSync(join(folder, "0000_probe.sql"), "ALTER TABLE `no_such_table_probe` ADD `x` int;");
    writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({
      version: "5", dialect: "mysql",
      entries: [{ idx: 0, version: "5", when: 1, tag: "0000_probe", breakpoints: true }],
    }));

    const r = runMigrate(tmp, scratchUrl(scratch));
    expect(r.status, "падение наката не остановило бы задание CI").toBe(1);
    const first = r.stderr.split(/\r?\n/)[0];
    // По «Error:» в начале строки ci-run.sh находит причину для пометки.
    expect(first).toMatch(/^Error: миграция не встала: /);
    expect(r.stderr).toContain("ALTER TABLE `no_such_table_probe`");
    expect(r.stderr, "ответ MySQL потерялся").toMatch(/no_such_table_probe' doesn't exist/);
  }, 120_000);
});
