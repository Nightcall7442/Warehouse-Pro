/**
 * Копия базы обязана разворачиваться.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Выгрузку делал внешний `mysqldump`. В образе он ставился пакетом
 * `mysql-client`, а в Alpine под этим именем лежит клиент MariaDB — настоящий
 * mysqldump там переименован в `mariadb-dump`. Клиент MariaDB не умеет способ
 * входа `caching_sha2_password`, который MySQL 8 назначает пользователям по
 * умолчанию, и выгрузка падала прямо на входе:
 *
 *     mysqldump: Got error: 1045: "Plugin caching_sha2_password could not be
 *     loaded" when trying to connect
 *
 * Сломано это было с самого начала и молчало до первой попытки скачать копию.
 * Ночная копия в S3 ходила той же дорогой — то есть резервных копий не было
 * вовсе, и узнать об этом было неоткуда.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * Настоящего сервера MySQL в тесте нет, поэтому проверяется то, что от него не
 * зависит и при этом решает судьбу копии: попадут ли в текст все объекты базы,
 * переживут ли значения дорогу туда и обратно, и не окажется ли в выгрузке
 * того, что при восстановлении вызовет ошибку.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";

vi.mock("../lib/env", () => ({
  env: { databaseUrl: "mysql://wp:secret@db.internal:3306/warehouse" },
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/* ── Двойник сервера ────────────────────────────────────────────────────────
   Отвечает ровно тем, чем отвечает MySQL: information_schema, SHOW CREATE и
   выборка строк потоком. */

interface FakeTable {
  create: string;
  columns: Array<{ name: string; extra?: string }>;
  rows: unknown[][];
}

const db: {
  tables: Record<string, FakeTable>;
  views: Record<string, string>;
  triggers: Record<string, string>;
  routines: Record<string, { type: "PROCEDURE" | "FUNCTION"; create: string }>;
  statements: string[];
  ended: number;
} = { tables: {}, views: {}, triggers: {}, routines: {}, statements: [], ended: 0 };

function escape(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`;
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const connection = {
  escape,
  escapeId: (id: string) => `\`${id.replace(/`/g, "``")}\``,
  end: async () => { db.ended++; },
  destroy: () => { db.ended++; },
  async query(sql: string | { sql: string }, params?: unknown[]) {
    const text = typeof sql === "string" ? sql : sql.sql;
    db.statements.push(text);

    if (text.includes("information_schema.TABLES")) {
      return [[
        ...Object.keys(db.tables).map(name => ({ name, type: "BASE TABLE" })),
        ...Object.keys(db.views).map(name => ({ name, type: "VIEW" })),
      ]];
    }
    if (text.includes("information_schema.TRIGGERS")) {
      return [Object.keys(db.triggers).map(name => ({ name }))];
    }
    if (text.includes("information_schema.ROUTINES")) {
      return [Object.entries(db.routines).map(([name, r]) => ({ name, type: r.type }))];
    }
    if (text.includes("information_schema.COLUMNS")) {
      const table = String(params?.[1]);
      return [db.tables[table].columns
        // Тот же отбор, что делает настоящий запрос: вычисляемые столбцы прочь.
        .filter(c => !(c.extra ?? "").includes("GENERATED"))
        .map(c => ({ name: c.name }))];
    }
    const show = /^SHOW CREATE (TABLE|VIEW|TRIGGER|PROCEDURE|FUNCTION) `(.+)`$/.exec(text);
    if (show) {
      const [, kind, name] = show;
      if (kind === "TABLE")   return [[{ "Create Table": db.tables[name].create }]];
      if (kind === "VIEW")    return [[{ "Create View": db.views[name] }]];
      if (kind === "TRIGGER") return [[{ "SQL Original Statement": db.triggers[name] }]];
      const key = kind === "FUNCTION" ? "Create Function" : "Create Procedure";
      return [[{ [key]: db.routines[name].create }]];
    }
    return [[]];
  },
  // Ядро соединения: через него идёт потоковое чтение строк.
  connection: {
    query({ sql }: { sql: string }) {
      const name = /FROM `(.+?)`$/.exec(sql)?.[1] ?? "";
      return { stream: () => Readable.from(db.tables[name]?.rows ?? [], { objectMode: true }) };
    },
  },
};

vi.mock("mysql2/promise", () => ({
  default: { createConnection: async () => connection },
}));

const { startDump, DumpUnavailableError, parseDatabaseUrl } = await import("../services/db-dump");

async function dumpToText(): Promise<string> {
  const { stream } = await startDump(new Date("2026-09-08T12:00:00Z"));
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return gunzipSync(Buffer.concat(chunks)).toString("utf8");
}

beforeEach(() => {
  db.tables = {
    users: {
      create: "CREATE TABLE `users` (\n  `id` bigint unsigned NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n)",
      columns: [{ name: "id" }, { name: "name" }, { name: "debt" }],
      rows: [[1, "Иван", "1500.50"], [2, null, "0.00"]],
    },
  };
  db.views = {};
  db.triggers = {};
  db.routines = {};
  db.statements = [];
  db.ended = 0;
});

describe("копия базы", () => {
  it("снимается согласованным снимком, не блокируя склад", async () => {
    await dumpToText();
    // Ровно то, что mysqldump делает под --single-transaction. Без этого две
    // таблицы в копии могли бы относиться к разным моментам времени, и связи
    // между ними при восстановлении не сошлись бы.
    expect(db.statements).toContain("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    expect(db.statements).toContain("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  });

  it("содержит схему и данные таблицы", async () => {
    const sql = await dumpToText();
    expect(sql).toContain("DROP TABLE IF EXISTS `users`;");
    expect(sql).toContain("CREATE TABLE `users`");
    expect(sql).toContain("INSERT INTO `users` (`id`,`name`,`debt`) VALUES ");
    expect(sql).toContain("(1,'Иван','1500.50')");
    // Пустое значение обязано остаться пустым, а не стать строкой "null".
    expect(sql).toContain("(2,NULL,'0.00')");
  });

  it("снимает проверку связей на время восстановления", async () => {
    const sql = await dumpToText();
    /*
      Таблицы восстанавливаются по алфавиту, а не по порядку связей: order_items
      лягут раньше orders. Без снятия проверки восстановление падало бы на
      первом же внешнем ключе.
    */
    expect(sql).toContain("FOREIGN_KEY_CHECKS=0;");
    expect(sql).toContain("SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;");
  });

  it("не пытается записать в вычисляемый столбец", async () => {
    db.tables.users.columns.push({ name: "search_key", extra: "STORED GENERATED" });
    const sql = await dumpToText();
    // MySQL отвечает ошибкой 3105 на попытку вставить значение в такой столбец:
    // копия выглядела бы исправной и не разворачивалась.
    expect(sql).not.toContain("search_key");
  });

  it("представления, триггеры и процедуры не теряются", async () => {
    db.views = { active_shops: "CREATE ALGORITHM=UNDEFINED DEFINER=`wp`@`%` VIEW `active_shops` AS SELECT 1" };
    db.triggers = { debt_after_order: "CREATE DEFINER=`wp`@`%` TRIGGER `debt_after_order` AFTER INSERT ON `orders` FOR EACH ROW BEGIN END" };
    db.routines = { recalc: { type: "PROCEDURE", create: "CREATE DEFINER=`wp`@`%` PROCEDURE `recalc`() BEGIN END" } };

    const sql = await dumpToText();

    expect(sql).toContain("DROP VIEW IF EXISTS `active_shops`;");
    expect(sql).toContain("DROP TRIGGER IF EXISTS `debt_after_order`;");
    expect(sql).toContain("DROP PROCEDURE IF EXISTS `recalc`;");
    // Тело содержит точки с запятой — без смены разделителя клиент разорвал бы
    // его на середине.
    expect(sql).toContain("DELIMITER ;;");
    expect(sql).toContain("DELIMITER ;\n");
  });

  it("имя создателя из копии убрано", async () => {
    db.views = { active_shops: "CREATE ALGORITHM=UNDEFINED DEFINER=`wp`@`%` VIEW `active_shops` AS SELECT 1" };
    const sql = await dumpToText();
    /*
      DEFINER указывает на пользователя той базы, откуда снята копия. При
      восстановлении в другую базу — на стенд, на новую службу, к себе на
      машину — такого пользователя нет, и сервер отвечает ошибкой 1449. Копия
      нужна именно для этих случаев.
    */
    expect(sql).not.toContain("DEFINER");
    expect(sql).toContain("VIEW `active_shops`");
  });

  it("представления идут после таблиц", async () => {
    db.views = { active_shops: "CREATE VIEW `active_shops` AS SELECT 1 FROM `users`" };
    const sql = await dumpToText();
    // Определение ссылается на таблицы: раньше них представление не создастся.
    expect(sql.indexOf("CREATE TABLE `users`")).toBeLessThan(sql.indexOf("VIEW `active_shops`"));
  });

  it("пустая база — это отказ, а не пустой архив", async () => {
    db.tables = {};
    // Человек положит такой файл в архив и узнает правду в худший момент.
    await expect(startDump()).rejects.toBeInstanceOf(DumpUnavailableError);
  });

  it("соединение закрывается, чем бы дело ни кончилось", async () => {
    await dumpToText();
    expect(db.ended).toBeGreaterThan(0);

    db.tables = {};
    await startDump().catch(() => {});
    expect(db.ended).toBeGreaterThan(1);
  });

  it("испорченная строка подключения — понятный отказ", async () => {
    expect(() => parseDatabaseUrl("не-адрес")).toThrow(DumpUnavailableError);
    expect(() => parseDatabaseUrl("mysql://user@host/")).toThrow(DumpUnavailableError);
  });

  it("имя файла несёт время снятия", async () => {
    const { filename } = await startDump(new Date("2026-09-08T12:00:00Z"));
    expect(filename).toBe("warehouse-pro-2026-09-08T12-00-00.sql.gz");
  });
});
