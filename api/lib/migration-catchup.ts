import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/* ═══════════════════════════════════════════════════════════════════════════
   Догоняющий проход по миграциям.

   ── Что происходит без него ────────────────────────────────────────────────

   Мигратор drizzle сравнивает журнал не с тем, что применено, а с ОДНОЙ
   строкой — самой поздней по created_at:

       select id, hash, created_at from __drizzle_migrations
       order by created_at desc limit 1
       ...
       if (!last || Number(last.created_at) < migration.folderMillis) применить

   То есть решение принимается по одному числу. Стоит в таблице оказаться
   записи с меткой из будущего — и КАЖДАЯ миграция с меньшей меткой
   пропускается молча и навсегда. Мигратор при этом рапортует об успехе:
   «database migrations up to date».

   Это уже случалось. Метки 0018–0020 однажды проставили руками датами из
   будущего, и всё с 0021 по 0038 перестало применяться; обнаружилось через
   несколько дней и в другом месте — супервайзер не мог создать план визита,
   потому что колонки daily_plans.visited_at в базе не было.

   Тогда написали проверку (reportSkippedMigrations в boot.ts): она СООБЩАЕТ о
   пропущенных, но применить их не может. 8 сентября 2026 то же самое повторилось
   ровно так же: 0007, 0008 и 0009 не применились, страница зарплат отвечала
   «Внутренняя ошибка сервера», а в логе стояло «Unknown column 'delivery_rate'».
   Проверка честно назвала все три — и всё.

   ── Что делает этот проход ─────────────────────────────────────────────────

   Сверяет журнал с таблицей ПОФАЙЛОВО, а не по последней метке, и применяет
   недостающие в порядке журнала. Запускается после штатного мигратора: на
   чистой базе ему нечего делать, он нужен только там, где расхождение уже
   есть.

   ── Про «уже существует» ───────────────────────────────────────────────────

   Часть пропущенного когда-то досыпали руками — в базе объект есть, в журнале
   отметки нет. Такому файлу проход прощает ровно те ошибки, которые означают
   «желаемое состояние уже достигнуто»: таблица есть, колонка есть, индекс
   есть, удалять нечего. Каждое прощение пишется в лог поимённо.

   И с этого места файл считается нанесённым руками: его перепись данных
   больше не выполняется. DDL от повтора не портится, а INSERT — портит.
   0007 создаёт support_threads и следом переносит туда по строке на каждый
   существующий разговор; повтор дал бы два потока на один разговор, и оба со
   своим сроком хранения. Пропущенная миграция — беда поправимая, задвоенные
   данные — нет.

   Всё остальное — ошибка: проход бросает её дальше, и запуск прекращается,
   как и прежде. Прощать вообще всё значило бы завести мигратор, который
   всегда «успешен», а схема живёт своей жизнью, — то есть ровно ту беду, из-за
   которой этот файл и появился.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Коды MySQL, означающие «оно уже такое».
 *
 * 1050 — таблица существует; 1060 — колонка существует; 1061 — индекс с таким
 * именем есть; 1091 — нечего удалять (DROP COLUMN/INDEX по отсутствующему);
 * 1826/1022 — такое ограничение или ключ уже заведены.
 */
const ALREADY_THERE = new Set([1050, 1060, 1061, 1091, 1826, 1022]);

type JournalEntry = { idx: number; when: number; tag: string };

/** Минимум от drizzle-соединения, который здесь нужен. */
type Executor = {
  execute: (query: ReturnType<typeof sql.raw> | ReturnType<typeof sql>) => Promise<unknown>;
};

/**
 * Достать код MySQL из ошибки.
 *
 * Идти по цепочке `cause` обязательно: drizzle заворачивает исходную ошибку в
 * свой DrizzleQueryError, у которого никакого errno нет — он лежит на причине.
 * Смотреть только на верхний уровень значило бы не узнать код НИ РАЗУ, то есть
 * иметь список прощаемых кодов, который не срабатывает никогда. Ровно на этом
 * первая выкладка догона и отказалась стартовать: `support_threads` в базе уже
 * была, ошибка пришла с кодом 1050 внутри обёртки, а проход её не разглядел.
 */
function errnoOf(e: unknown): number | null {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth++) {
    const errno = (cur as { errno?: unknown }).errno;
    if (typeof errno === "number") return errno;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** Текст самой глубокой причины — то, что на самом деле сказал MySQL. */
function causeTextOf(e: unknown): string {
  let last = e;
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth++) {
    last = cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return last instanceof Error ? last.message : String(last);
}

/**
 * Применить то, что штатный мигратор пропустил.
 *
 * Возвращает метки применённых файлов — по ним тест и лог понимают, что
 * проход действительно что-то сделал.
 */
export async function catchUpMigrations(
  db: Executor,
  folder = "./db/migrations",
): Promise<string[]> {
  const journal = JSON.parse(
    await readFile(`${folder}/meta/_journal.json`, "utf-8"),
  ) as { entries: JournalEntry[] };

  /*
    Таблицу создаёт штатный мигратор до нас. Если её нет, значит он не
    отработал — догонять нечего и не за чем.
  */
  const [rows] = await db.execute(
    sql`SELECT created_at FROM __drizzle_migrations`,
  ) as unknown as [Array<{ created_at: number | string }>, unknown];

  const applied = new Set((rows ?? []).map(r => String(Number(r.created_at))));
  const missing = journal.entries.filter(e => !applied.has(String(e.when)));
  if (missing.length === 0) return [];

  logger.warn("догоняю миграции, пропущенные штатным мигратором", {
    count: missing.length,
    migrations: missing.map(e => e.tag),
    why: "drizzle сверяется только с последней меткой created_at",
  });

  const done: string[] = [];

  for (const entry of missing) {
    const file = await readFile(`${folder}/${entry.tag}.sql`, "utf-8");
    // Тот же разбор, что у drizzle: файл делится маркером на выражения.
    const statements = file.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);

    /*
      Было ли в этом файле хоть одно «уже такое».

      Если да, файл наносили руками, и данные, которые он досыпает, скорее
      всего досыпаны тоже. Выполнить после этого его INSERT значило бы
      ЗАДВОИТЬ строки — а это уже не пропущенная миграция, а испорченные
      данные. Скажем 0007: он создаёт support_threads и следом переносит в неё
      по строке на каждый существующий разговор. Повтор дал бы два потока на
      один разговор, и оба со своим сроком хранения.

      Поэтому после первого прощения переписи данных в этом файле не трогаем.
      Схему — трогаем: DDL идемпотентен ровно теми кодами, что мы прощаем.
    */
    let handMade = false;

    for (const statement of statements) {
      const isSchemaChange = /^\s*(CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i.test(statement);

      if (handMade && !isSchemaChange) {
        logger.warn("перепись данных пропущена: файл уже наносили руками", {
          migration: entry.tag,
          statement: statement.slice(0, 140),
          why: "повтор задвоил бы строки",
        });
        continue;
      }

      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        const errno = errnoOf(e);
        if (errno !== null && ALREADY_THERE.has(errno)) {
          // Нанесено руками мимо журнала — отметить и идти дальше.
          handMade = true;
          logger.warn("часть миграции уже была нанесена — пропускаю", {
            migration: entry.tag, errno,
            statement: statement.slice(0, 140),
          });
          continue;
        }
        logger.error("догоняющая миграция не применилась", {
          migration: entry.tag,
          statement: statement.slice(0, 140),
          // errno и причина — отдельными полями: у DrizzleQueryError своё
          // сообщение «Failed query: …», и настоящая причина в нём не видна.
          errno,
          cause: causeTextOf(e),
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    }

    /*
      Хэш считается от ЦЕЛОГО файла, как у drizzle: иначе запись будет
      несовместима с его собственными и следующая сверка сочтёт файл чужим.
    */
    const hash = createHash("sha256").update(file).digest("hex");
    await db.execute(
      sql`INSERT INTO __drizzle_migrations (\`hash\`, \`created_at\`) VALUES (${hash}, ${entry.when})`,
    );
    done.push(entry.tag);
    logger.info("миграция догнана", { migration: entry.tag });
  }

  return done;
}
