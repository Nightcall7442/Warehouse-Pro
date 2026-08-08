import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

/**
 * Логическая копия базы — та, из которой можно достать одну таблицу.
 *
 * Снимки диска, которые делает платформа, спасают от смерти диска, но не от
 * ошибки человека: чтобы отменить одно неверное удаление, снимок предлагает
 * откатить базу целиком на сутки назад, вместе со всеми заказами и платежами,
 * записанными после. Вдобавок восстановление снимка на Railway удаляет все
 * копии, сделанные позже восстанавливаемой, — то есть проверить его нельзя, не
 * израсходовав сам запас.
 *
 * Здесь — SQL-текст, который разворачивается куда угодно и сколько угодно раз.
 * Его можно проверить, не тратя ничего.
 *
 * Отдаётся потоком, а не файлом. Файл пришлось бы держать в памяти целиком, и
 * дважды: сначала вывод mysqldump, потом его сжатая копия. Это тот же процесс,
 * который обслуживает запросы пользователей, и на растущей базе такая выгрузка
 * стала бы способом положить продукт вместо способа его защитить.
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
 * Пароль возвращается отдельным полем и дальше уходит в переменную окружения
 * дочернего процесса, а не в аргументы командной строки: аргументы видны в
 * списке процессов всем, кто окажется внутри контейнера.
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
    database: parsed.pathname.replace(/^\//, ""),
  };
  if (!creds.host || !creds.user || !creds.database) {
    throw new DumpUnavailableError("В DATABASE_URL нет узла, пользователя или базы");
  }
  return creds;
}

/**
 * Запустить выгрузку.
 *
 * Обещание разрешается не сразу, а после первых байт вывода — либо
 * отклоняется, если mysqldump не запустился или завершился с ошибкой, ничего
 * не выдав. Это важно для честного ответа по HTTP: заголовки уходят первыми и
 * назад не отзываются, поэтому решение «получилось или нет» должно быть
 * принято до них. Иначе сорвавшаяся выгрузка выглядела бы как успешная
 * загрузка испорченного файла.
 *
 * Если mysqldump оборвётся уже посреди передачи, поток закрывается ошибкой, и
 * файл придёт неполным. Незамеченным это не останется: сжатие устроено так,
 * что оборванный архив не распакуется — в отличие от голого SQL, у которого
 * обрыв на середине выглядит как обычный текст и всплыл бы только при попытке
 * восстановиться.
 */
export async function startDump(now: Date = new Date()): Promise<DumpHandle> {
  const creds = parseDatabaseUrl(env.databaseUrl);
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `warehouse-pro-${stamp}.sql.gz`;

  const child = spawn("mysqldump", [
    // Согласованный снимок без блокировки таблиц: выгрузка не должна
    // останавливать работу склада.
    "--single-transaction",
    // Строки идут потоком, а не собираются в памяти mysqldump целиком.
    "--quick",
    "--routines",
    "--triggers",
    `--host=${creds.host}`,
    `--port=${creds.port}`,
    `--user=${creds.user}`,
    creds.database,
  ], { env: { ...process.env, MYSQL_PWD: creds.password } });

  const gzip = createGzip();
  child.stdout.pipe(gzip);

  let stderr = "";
  child.stderr.on("data", (c: Buffer) => { stderr += c.toString().slice(0, 4000); });

  return new Promise<DumpHandle>((resolve, reject) => {
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new DumpUnavailableError(message));
    };

    child.on("error", (e) => {
      // Сюда попадает и отсутствие самого mysqldump в образе — случай, который
      // иначе выглядел бы как пустая, но успешная выгрузка.
      fail(`mysqldump не запустился: ${e.message}`);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        logger.error("dump: mysqldump exited non-zero", { code, stderr: stderr.slice(0, 500) });
        fail(`mysqldump завершился с кодом ${code}: ${stderr.slice(0, 300)}`);
      }
    });

    gzip.once("data", () => {
      if (settled) return;
      settled = true;
      // Первые байты получены — дальше поток отдаётся клиенту как есть.
      resolve({ stream: gzip, filename });
    });

    gzip.once("end", () => {
      // Пустая выгрузка при нулевом коде возврата тоже неудача: отдавать
      // человеку пустой архив под видом резервной копии нельзя.
      fail("mysqldump не выдал ни одной строки");
    });
  });
}
