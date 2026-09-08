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

function errnoOf(e: unknown): number | null {
  const errno = (e as { errno?: unknown })?.errno;
  return typeof errno === "number" ? errno : null;
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

    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        const errno = errnoOf(e);
        if (errno !== null && ALREADY_THERE.has(errno)) {
          // Нанесено руками мимо журнала — отметить и идти дальше.
          logger.warn("часть миграции уже была нанесена — пропускаю", {
            migration: entry.tag, errno,
            statement: statement.slice(0, 140),
          });
          continue;
        }
        logger.error("догоняющая миграция не применилась", {
          migration: entry.tag,
          statement: statement.slice(0, 140),
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
