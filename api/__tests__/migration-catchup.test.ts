import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

/**
 * Догон миграций, пропущенных штатным мигратором.
 *
 * ── Что случилось ───────────────────────────────────────────────────────────
 *
 * Мигратор drizzle сверяет журнал не с тем, что применено, а с ОДНОЙ строкой —
 * самой поздней по created_at:
 *
 *     select ... from __drizzle_migrations order by created_at desc limit 1
 *     if (!last || Number(last.created_at) < migration.folderMillis) применить
 *
 * Одна запись с меткой из будущего поэтому глушит КАЖДУЮ миграцию с меньшей
 * меткой — молча и навсегда, с рапортом «database migrations up to date».
 *
 * 8 сентября 2026 так пропали 0007, 0008 и 0009. Страница зарплат отвечала
 * «Внутренняя ошибка сервера», в логе стояло «Unknown column 'delivery_rate'»,
 * а строкой выше — сообщение об успехе. Ровно та же беда была раньше с
 * 0021–0038: тогда написали проверку, которая ТОЛЬКО называет пропущенных.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Главное: файл, которого нет в таблице, применяется, даже если его метка
 * МЕНЬШЕ максимальной. Это и есть то, чего штатный мигратор не делает.
 */

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Разбор `sql` тут не нужен: фальшивое соединение читает то, что ему передали.
vi.mock("drizzle-orm", async () => {
  const raw = (str: string) => ({ __raw: str });
  const tag = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __tag: strings.join("?"), values }),
    { raw },
  );
  return { sql: tag };
});

type Call = { kind: "raw" | "tag"; text: string; values?: unknown[] };

/** Соединение-стенд: помнит, что применено, и умеет отказать нужным кодом. */
function fakeDb(appliedMillis: number[], fail?: (statement: string) => number | null) {
  const calls: Call[] = [];
  return {
    calls,
    execute: vi.fn(async (q: { __raw?: string; __tag?: string; values?: unknown[] }) => {
      if (q.__raw !== undefined) {
        const errno = fail?.(q.__raw) ?? null;
        calls.push({ kind: "raw", text: q.__raw });
        if (errno !== null) {
          const e = new Error("отказ стенда") as Error & { errno: number };
          e.errno = errno;
          throw e;
        }
        return [[], undefined];
      }
      const text = q.__tag ?? "";
      calls.push({ kind: "tag", text, values: q.values });
      if (/SELECT created_at FROM __drizzle_migrations/i.test(text)) {
        return [appliedMillis.map(m => ({ created_at: m })), undefined];
      }
      return [[], undefined];
    }),
  };
}

/** Журнал из трёх файлов; метки нарочно НЕ растут после первого. */
async function makeFolder() {
  const dir = await mkdtemp(join(tmpdir(), "wp-migrations-"));
  await mkdir(join(dir, "meta"), { recursive: true });
  await writeFile(join(dir, "meta", "_journal.json"), JSON.stringify({
    entries: [
      { idx: 0, when: 1000, tag: "0000_base" },
      { idx: 1, when: 2000, tag: "0001_second" },
      { idx: 2, when: 3000, tag: "0002_third" },
      { idx: 3, when: 4000, tag: "0003_backfill" },
    ],
  }), "utf8");
  // Схема плюс перепись данных — та же пара, что в 0007_support_threads.
  await writeFile(join(dir, "0003_backfill.sql"),
    "CREATE TABLE t (id int);\n--> statement-breakpoint\nINSERT INTO t SELECT id FROM a;", "utf8");
  await writeFile(join(dir, "0000_base.sql"), "CREATE TABLE a (id int);", "utf8");
  await writeFile(join(dir, "0001_second.sql"),
    "ALTER TABLE a ADD b int;\n--> statement-breakpoint\nALTER TABLE a ADD c int;", "utf8");
  await writeFile(join(dir, "0002_third.sql"), "ALTER TABLE a ADD d int;", "utf8");
  return dir;
}

let folder = "";
beforeEach(async () => { folder = await makeFolder(); });

describe("догон применяет пропущенное", () => {
  it("метка из будущего больше ничего не глушит", async () => {
    /*
      В таблице только 0000 — и запись с меткой 9999, которой в журнале нет
      вовсе. Штатный мигратор увидел бы 9999 и не применил НИЧЕГО. Догон
      обязан применить 0001 и 0002.
    */
    const { catchUpMigrations } = await import("../lib/migration-catchup");
    const db = fakeDb([1000, 9999]);

    const done = await catchUpMigrations(db as never, folder);

    expect(done, "пропущенные так и не применились")
      .toEqual(["0001_second", "0002_third", "0003_backfill"]);
    const ddl = db.calls.filter(c => c.kind === "raw").map(c => c.text);
    expect(ddl).toEqual([
      "ALTER TABLE a ADD b int;",
      "ALTER TABLE a ADD c int;",
      "ALTER TABLE a ADD d int;",
      "CREATE TABLE t (id int);",
      "INSERT INTO t SELECT id FROM a;",
    ]);
  });

  it("уже применённое не трогает", async () => {
    const { catchUpMigrations } = await import("../lib/migration-catchup");
    const db = fakeDb([1000, 2000, 3000, 4000]);
    expect(await catchUpMigrations(db as never, folder)).toEqual([]);
    expect(db.calls.filter(c => c.kind === "raw")).toHaveLength(0);
  });

  it("отметка пишется меткой из журнала и хэшем всего файла", async () => {
    /*
      Хэш обязан совпадать с тем, что считает сам drizzle (sha256 от целого
      файла): иначе его следующая сверка сочтёт запись чужой.
    */
    const { createHash } = await import("node:crypto");
    const { catchUpMigrations } = await import("../lib/migration-catchup");
    const db = fakeDb([1000, 2000]);

    await catchUpMigrations(db as never, folder);

    const insert = db.calls.find(c => c.kind === "tag" && /INSERT INTO __drizzle_migrations/i.test(c.text));
    expect(insert, "отметка не записана — догон повторится на каждом запуске").toBeDefined();
    const expected = createHash("sha256")
      .update(readFileSync(join(folder, "0002_third.sql"), "utf8"))
      .digest("hex");
    expect(insert!.values).toEqual([expected, 3000]);
  });
});

describe("что догон прощает, а что нет", () => {
  it("«колонка уже есть» — не повод падать", async () => {
    /*
      Часть пропущенного когда-то досыпали руками: в базе объект есть, в
      журнале отметки нет. Падать на этом значило бы не пускать продукт из-за
      того, что нужное уже сделано.
    */
    const { catchUpMigrations } = await import("../lib/migration-catchup");
    const db = fakeDb([1000], st => (st.includes("ADD b") ? 1060 : null));

    const done = await catchUpMigrations(db as never, folder);

    expect(done).toEqual(["0001_second", "0002_third", "0003_backfill"]);
    // Файл дочитан до конца: второе выражение выполнено, несмотря на отказ первого.
    expect(db.calls.some(c => c.text === "ALTER TABLE a ADD c int;")).toBe(true);
  });

  it("код виден и через обёртку drizzle", async () => {
    /*
      Главное здесь. Drizzle заворачивает ошибку MySQL в свой DrizzleQueryError,
      у которого errno нет — он лежит на причине. Пока проход смотрел только
      верхний уровень, список прощаемых кодов не срабатывал НИ РАЗУ, и первая
      выкладка отказалась стартовать: `support_threads` в базе уже была, ошибка
      пришла с 1050 внутри обёртки, а проход её не разглядел.
    */
    const { catchUpMigrations } = await import("../lib/migration-catchup");
    const db = {
      execute: vi.fn(async (q: { __raw?: string; __tag?: string }) => {
        if (q.__tag && /SELECT created_at/i.test(q.__tag)) return [[{ created_at: 1000 }], undefined];
        if (q.__raw?.includes("ADD b")) {
          const inner = new Error("Duplicate column name 'b'") as Error & { errno: number };
          inner.errno = 1060;
          throw new Error("Failed query: ...", { cause: inner });
        }
        return [[], undefined];
      }),
    };

    await expect(catchUpMigrations(db as never, folder))
      .resolves.toEqual(["0001_second", "0002_third", "0003_backfill"]);
  });

  it("после прощения перепись данных не повторяется", async () => {
    /*
      Файл наносили руками — значит и данные, которые он досыпает, скорее
      всего досыпаны. Повтор INSERT задвоил бы строки: у 0007 это два потока
      поддержки на один разговор, каждый со своим сроком хранения.

      Пропущенная миграция поправима, задвоенные данные — нет.
    */
    const { catchUpMigrations } = await import("../lib/migration-catchup");
    const db = fakeDb([1000, 2000, 3000], st => (st.startsWith("CREATE TABLE t") ? 1050 : null));

    await catchUpMigrations(db as never, folder);

    expect(db.calls.some(c => c.text.startsWith("INSERT INTO t")),
      "перепись выполнилась поверх уже нанесённой вручную").toBe(false);
  });

  it("настоящая ошибка не проглатывается", async () => {
    // Иначе получился бы мигратор, который всегда «успешен», а схема живёт
    // своей жизнью — ровно та беда, из-за которой догон и написан. Решение,
    // ронять ли из-за этого запуск, принимает boot.ts (см. ниже) — но узнать
    // о сбое он должен.
    const { catchUpMigrations } = await import("../lib/migration-catchup");
    const db = fakeDb([1000], st => (st.includes("ADD b") ? 1064 : null));

    await expect(catchUpMigrations(db as never, folder)).rejects.toThrow();
    expect(db.calls.some(c => c.text === "ALTER TABLE a ADD d int;"),
      "после сбоя проход пошёл дальше").toBe(false);
  });
});

describe("догон включён в запуск", () => {
  const boot = readFileSync(join(__dirname, "..", "boot.ts"), "utf8");

  it("вызывается при старте", () => {
    expect(boot).toContain("catchUpMigrations");
  });

  it("его провал не роняет запуск", () => {
    /*
      Штатный мигратор применяет то, чего требует НОВЫЙ код: не применилось —
      работать нельзя, и он валит старт. Догон применяет старое, пропущенное;
      его неудача означает «осталось как было» — то состояние, в котором
      продукт только что работал.

      На первой выкладке догон споткнулся на 0007 и увёл в отказ старта весь
      сервис: вместо одной сломанной страницы стало ноль работающих.
    */
    const at = boot.indexOf("await catchUpMigrations(");
    const around = boot.slice(Math.max(0, at - 200), at + 1600);
    expect(around).toMatch(/try\s*\{/);
    expect(around).toContain("продолжаю запуск на прежней схеме");
  });

  it("идёт после штатного мигратора и под тем же замком", () => {
    /*
      До замка — гонка двух реплик на одном DDL. После освобождения замка —
      то же самое. Порядок важен: штатный мигратор создаёт саму таблицу
      __drizzle_migrations, из которой догон читает.
      */
    const at = boot.indexOf("withMigrationLock");
    const block = boot.slice(at, boot.indexOf("logger.info(\"database migrations up to date\")"));
    const migrateAt = block.indexOf("await migrate(db");
    const catchAt = block.indexOf("await catchUpMigrations(");
    expect(migrateAt).toBeGreaterThan(0);
    expect(catchAt).toBeGreaterThan(migrateAt);
  });
});
