import mysql from "mysql2/promise";
import { createGzip } from "node:zlib";
import { Readable, pipeline } from "node:stream";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

/**
 * Логическая копия базы — та, из которой можно достать одну таблицу.
 *
 * Снимки тома, которые делает платформа, у нас включены (ежедневный,
 * недельный, месячный) и от смерти диска спасают. От ошибки человека — нет:
 * чтобы отменить одно неверное удаление, снимок предлагает откатить базу
 * целиком на сутки назад, вместе со всеми заказами и платежами, записанными
 * после. Достать из него одну таблицу или один заказ нельзя.
 *
 * Второе их ограничение — место жительства. Снимки лежат в том же проекте
 * Railway, что и сама база: потеря доступа к учётной записи или удаление
 * проекта уносит их вместе с базой.
 *
 * Здесь — SQL-текст, который разворачивается куда угодно и сколько угодно раз,
 * лежит вне платформы и позволяет достать ровно то, что нужно. Его можно
 * проверить, ничего не тратя.
 *
 * Отдаётся потоком, а не файлом. Файл пришлось бы держать в памяти целиком, и
 * дважды: сначала текст выгрузки, потом его сжатая копия. Это тот же процесс,
 * который обслуживает запросы пользователей, и на растущей базе такая выгрузка
 * стала бы способом положить продукт вместо способа его защитить.
 *
 * ── Почему копию собирает Node, а не mysqldump ───────────────────────────────
 *
 * Раньше запускался внешний `mysqldump`. В образе (`node:22-alpine`) он ставился
 * пакетом `mysql-client`, а в Alpine под этим именем лежит клиент MariaDB:
 * настоящий `mysqldump` там просто переименован в `mariadb-dump`. Клиент
 * MariaDB не умеет способ входа `caching_sha2_password`, который MySQL 8
 * назначает пользователям по умолчанию, и выгрузка падала на самом входе:
 *
 *     mysqldump: Got error: 1045: "Plugin caching_sha2_password could not be
 *     loaded" when trying to connect
 *
 * Дыра была не в настройке, а в самом приёме: копия базы зависела от чужой
 * программы, которой в образе нет, которая называется не так, как её зовут, и
 * которая говорит с сервером по другому набору правил, чем само приложение.
 * Сломалось молча — до первой попытки скачать копию.
 *
 * Поэтому выгрузку собирает то же соединение `mysql2`, которым приложение
 * работает каждый день: способ входа у него ровно тот, что нужен серверу, и
 * ломаться порознь им теперь негде. Заодно из образа уходит целый пакет.
 *
 * Согласованность снимка не потеряна: `START TRANSACTION WITH CONSISTENT
 * SNAPSHOT` — это ровно то, что `mysqldump --single-transaction` делает внутри.
 */

export interface DumpHandle {
  /** Сжатый поток SQL — готов к отдаче клиенту. */
  stream: Readable;
  /** Имя файла, которое увидит человек. */
  filename: string;
}

export class DumpUnavailableError extends Error {}

interface DbCredentials {
  host: string; port: string; user: string; password: string; database: string;
}

/**
 * Разобрать строку подключения.
 *
 * Нужны имя базы (по нему отбираются таблицы) и узел: у удалённого узла
 * соединение поднимается через TLS, у локального — нет. Пароль отсюда никуда
 * дальше не уходит: соединение открывается по той же строке целиком.
 */
export function parseDatabaseUrl(url: string): DbCredentials {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DumpUnavailableError("DATABASE_URL не разбирается");
  }
  const creds: DbCredentials = {
    host: parsed.hostname,
    port: parsed.port || "3306",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
  if (!creds.host || !creds.user || !creds.database) {
    throw new DumpUnavailableError("В DATABASE_URL нет узла, пользователя или базы");
  }
  return creds;
}

/**
 * Сколько текста SQL копится в одном INSERT.
 *
 * Одна строка на INSERT восстанавливается на порядок дольше; один INSERT на всю
 * таблицу не пролезет в `max_allowed_packet` принимающего сервера (по умолчанию
 * это 64 МБ, но у чужой установки он бывает и 4 МБ). Полмегабайта проходит
 * везде и при этом даёт почти весь выигрыш в скорости.
 */
const INSERT_CHUNK_BYTES = 512 * 1024;

interface DbObjects {
  tables: string[];
  views: string[];
  triggers: string[];
  routines: Array<{ name: string; type: "PROCEDURE" | "FUNCTION" }>;
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Ядро соединения — то, что умеет отдавать строки потоком.
 *
 * Обёртка с обещаниями держит его в поле `connection`, но в своих типах
 * объявляет это поле только у соединения из пула. Здесь описано ровно то, что
 * от него нужно: приведение к `any` спрятало бы заодно и настоящие ошибки.
 */
interface RowStreamSource {
  query(options: { sql: string; rowsAsArray: boolean }): { stream(): Readable };
}

function coreOf(conn: mysql.Connection): RowStreamSource {
  return (conn as unknown as { connection: RowStreamSource }).connection;
}

/** Локальный узел или удалённый: у удалённого соединение идёт через TLS. */
function isRemote(host: string): boolean {
  return host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(".local");
}

async function connect(creds: DbCredentials): Promise<mysql.Connection> {
  try {
    return await mysql.createConnection({
      uri: env.databaseUrl,
      connectTimeout: 30_000,
      /*
        Значения должны вернуться ровно теми, какими лежат в базе. Даты —
        строкой, иначе они прошли бы через Date и часовой пояс процесса;
        большие целые — строкой, иначе идентификатор за 2^53 потерял бы
        точность в double ещё до того, как попал бы в текст выгрузки.
      */
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      ...(isRemote(creds.host) ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  } catch (e) {
    throw new DumpUnavailableError(`не удалось подключиться к базе: ${reason(e)}`);
  }
}

/** Закрыть соединение, чем бы ни кончилось дело. */
function release(conn: mysql.Connection): void {
  conn.end().catch(() => conn.destroy());
}

/**
 * Что вообще лежит в базе.
 *
 * Спрашивается у самой базы, а не берётся из схемы в репозитории: выгрузка
 * обязана содержать то, что есть на сервере сейчас, включая таблицу, которую
 * кто-то завёл руками.
 */
async function readObjects(conn: mysql.Connection, database: string): Promise<DbObjects> {
  const [tableRows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    [database],
  );
  const [triggerRows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME",
    [database],
  );
  const [routineRows] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME",
    [database],
  );

  return {
    tables: tableRows.filter(r => r.type === "BASE TABLE").map(r => String(r.name)),
    views:  tableRows.filter(r => r.type === "VIEW").map(r => String(r.name)),
    triggers: triggerRows.map(r => String(r.name)),
    routines: routineRows.map(r => ({
      name: String(r.name),
      type: String(r.type) === "FUNCTION" ? "FUNCTION" as const : "PROCEDURE" as const,
    })),
  };
}

/**
 * Столбцы таблицы по порядку.
 *
 * Вычисляемые столбцы пропускаются: значение у них есть, а вставить его нельзя
 * — MySQL отвечает ошибкой 3105 на попытку записать в такой столбец. Без этого
 * отбора выгрузка выглядела бы исправной и не разворачивалась.
 */
async function columnsOf(conn: mysql.Connection, database: string, table: string): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        AND (EXTRA IS NULL OR EXTRA NOT LIKE '%GENERATED%')
      ORDER BY ORDINAL_POSITION`,
    [database, table],
  );
  return rows.map(r => String(r.name));
}

/**
 * Убрать `DEFINER=...` из определения представления, триггера или процедуры.
 *
 * MySQL записывает туда пользователя, от чьего имени объект создан. При
 * восстановлении в другую базу — на стенд, на новую службу платформы, к себе на
 * машину — такого пользователя обычно нет, и сервер отказывает с ошибкой 1449.
 * Копия нужна именно для этих случаев, поэтому имя создателя из неё убирается:
 * объект создастся от того, кто разворачивает.
 */
function stripDefiner(sql: string): string {
  return sql.replace(/\sDEFINER\s*=\s*`(?:[^`]|``)*`@`(?:[^`]|``)*`/gi, "");
}

async function createStatement(conn: mysql.Connection, sql: string, column: string): Promise<string> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(sql);
  const first = rows[0];
  if (!first || typeof first[column] !== "string") {
    throw new Error(`сервер не вернул определение (${sql})`);
  }
  return first[column] as string;
}

/**
 * Сам текст выгрузки, кусками.
 *
 * Генератор, а не строка: он отдаёт очередной кусок только тогда, когда
 * предыдущий уже забрали, поэтому размер базы не превращается в размер занятой
 * памяти. Ошибка внутри рвёт поток — так и задумано, см. startDump.
 */
async function* dumpText(
  conn: mysql.Connection,
  database: string,
  objects: DbObjects,
  now: Date,
): AsyncGenerator<string> {
  yield [
    `-- Warehouse Pro — логическая копия базы \`${database}\``,
    `-- Снята ${now.toISOString()}`,
    "--",
    "-- Восстановление:  gunzip -c <файл>.sql.gz | mysql -h <узел> -u <пользователь> -p <база>",
    "",
    "/*!40101 SET NAMES utf8mb4 */;",
    "SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;",
    "SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;",
    "SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
    "SET @OLD_TIME_ZONE=@@TIME_ZONE, TIME_ZONE='+00:00';",
    "",
  ].join("\n");

  for (const table of objects.tables) {
    const quoted = conn.escapeId(table);
    yield `\n--\n-- Таблица ${quoted}\n--\n\n`;
    yield `DROP TABLE IF EXISTS ${quoted};\n`;
    yield `${await createStatement(conn, `SHOW CREATE TABLE ${quoted}`, "Create Table")};\n\n`;

    const columns = await columnsOf(conn, database, table);
    if (columns.length === 0) continue;

    const columnList = columns.map(c => conn.escapeId(c)).join(",");
    const prefix = `INSERT INTO ${quoted} (${columnList}) VALUES `;
    /*
      Строки читаются потоком собственного соединения mysql2: обёртка с
      обещаниями отдаёт всю выборку разом, а таблица заказов целиком в памяти
      — это ровно то, чего выгрузка должна избегать.
    */
    const rows = coreOf(conn).query({
      sql: `SELECT ${columnList} FROM ${quoted}`,
      rowsAsArray: true,
    }).stream();

    let batch = "";
    for await (const row of rows as AsyncIterable<unknown[]>) {
      // conn.escape сам разбирает NULL, числа, строки, двоичные значения и
      // даты — своего экранирования здесь заводить нельзя.
      const tuple = `(${row.map(v => conn.escape(v)).join(",")})`;
      if (batch.length + tuple.length + 1 > INSERT_CHUNK_BYTES) {
        yield `${prefix}${batch};\n`;
        batch = "";
      }
      batch = batch ? `${batch},${tuple}` : tuple;
    }
    if (batch) yield `${prefix}${batch};\n`;
  }

  // Представления идут после таблиц: определение ссылается на них.
  for (const view of objects.views) {
    const quoted = conn.escapeId(view);
    yield `\n--\n-- Представление ${quoted}\n--\n\n`;
    yield `DROP VIEW IF EXISTS ${quoted};\n`;
    yield `${stripDefiner(await createStatement(conn, `SHOW CREATE VIEW ${quoted}`, "Create View"))};\n`;
  }

  /*
    У триггеров и процедур тело содержит точки с запятой, поэтому вокруг них
    переставляется разделитель — иначе клиент разорвёт тело на середине.
    DELIMITER понимает клиент mysql, которым такую копию и разворачивают.
  */
  for (const trigger of objects.triggers) {
    const quoted = conn.escapeId(trigger);
    yield `\n--\n-- Триггер ${quoted}\n--\n\n`;
    yield `DROP TRIGGER IF EXISTS ${quoted};\n`;
    yield "DELIMITER ;;\n";
    yield `${stripDefiner(await createStatement(conn, `SHOW CREATE TRIGGER ${quoted}`, "SQL Original Statement"))};;\n`;
    yield "DELIMITER ;\n";
  }

  for (const routine of objects.routines) {
    const quoted = conn.escapeId(routine.name);
    const column = routine.type === "FUNCTION" ? "Create Function" : "Create Procedure";
    yield `\n--\n-- ${routine.type === "FUNCTION" ? "Функция" : "Процедура"} ${quoted}\n--\n\n`;
    yield `DROP ${routine.type} IF EXISTS ${quoted};\n`;
    yield "DELIMITER ;;\n";
    yield `${stripDefiner(await createStatement(conn, `SHOW CREATE ${routine.type} ${quoted}`, column))};;\n`;
    yield "DELIMITER ;\n";
  }

  yield [
    "",
    "SET TIME_ZONE=@OLD_TIME_ZONE;",
    "SET SQL_MODE=@OLD_SQL_MODE;",
    "SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;",
    "SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;",
    "",
    "-- Конец копии",
    "",
  ].join("\n");
}

/**
 * Запустить выгрузку.
 *
 * Всё, что может не получиться, делается ДО того, как обещание разрешится:
 * соединение, снимок, перечень объектов. Это важно для честного ответа по
 * HTTP — заголовки уходят первыми и назад не отзываются, поэтому решение
 * «получилось или нет» должно быть принято до них. Иначе сорвавшаяся выгрузка
 * выглядела бы как успешная загрузка испорченного файла.
 *
 * Если чтение оборвётся уже посреди передачи, поток закрывается ошибкой, и файл
 * придёт неполным. Незамеченным это не останется: сжатие устроено так, что
 * оборванный архив не распакуется — в отличие от голого SQL, у которого обрыв
 * на середине выглядит как обычный текст и всплыл бы только при попытке
 * восстановиться.
 */
export async function startDump(now: Date = new Date()): Promise<DumpHandle> {
  const creds = parseDatabaseUrl(env.databaseUrl);
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `warehouse-pro-${stamp}.sql.gz`;

  const conn = await connect(creds);

  let objects: DbObjects;
  try {
    /*
      Согласованный снимок без блокировки таблиц: выгрузка не должна
      останавливать работу склада. Это же делает mysqldump --single-transaction.
    */
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    objects = await readObjects(conn, creds.database);
  } catch (e) {
    release(conn);
    throw new DumpUnavailableError(`не удалось начать выгрузку: ${reason(e)}`);
  }

  if (objects.tables.length === 0 && objects.views.length === 0) {
    // Пустая выгрузка — тоже неудача: отдавать человеку пустой архив под видом
    // резервной копии нельзя.
    release(conn);
    throw new DumpUnavailableError(`в базе \`${creds.database}\` нет ни одной таблицы — выгружать нечего`);
  }

  const source = Readable.from(dumpText(conn, creds.database, objects, now), { objectMode: false });
  const gzip = createGzip();

  /*
    Именно pipeline, а не pipe: при ошибке источника pipe оставил бы сжатый
    поток живым и корректно завершённым, то есть отдал бы обрезанный архив как
    исправный. pipeline рушит приёмник ошибкой, и обрыв виден на той стороне.
  */
  pipeline(source, gzip, (err) => {
    release(conn);
    if (err) logger.error("dump: выгрузка оборвалась", { error: reason(err) });
  });

  return { stream: gzip, filename };
}
