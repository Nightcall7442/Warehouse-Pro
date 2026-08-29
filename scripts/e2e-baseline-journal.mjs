import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

/**
 * Отметить миграции применёнными в свежесозданной базе для сквозных проверок.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Приложение при старте само накатывает миграции и отказывается стартовать,
 * если это не удалось (api/boot.ts). Схему для сквозных проверок ставит
 * `drizzle-kit push` — так же, как для проверок с настоящей базой. После push
 * таблицы есть, а журнала нет, и стартующее приложение попыталось бы накатить
 * всю цепочку поверх готовой схемы: первая же CREATE TABLE упала бы на «table
 * already exists», и сервер не поднялся бы.
 *
 * Поэтому журнал заполняется здесь: одна запись с временем последней миграции.
 * drizzle сравнивает именно created_at (mysql-core/dialect.js: применяются
 * миграции, у которых folderMillis больше последнего created_at) — хеш он
 * записывает, но никогда не сверяет. Одной записи достаточно.
 *
 * ── Чего это НЕ делает ──────────────────────────────────────────────────────
 *
 * Не чинит цепочку миграций. Накат с нуля сломан и сейчас — это видно по
 * отдельному потоку test-migrations, он красный. Здесь лишь развязаны две
 * разные проверки: сквозные проверяют поведение приложения, а применимость
 * миграций проверяет свой поток, для того и заведённый. Иначе одно чинилось бы
 * ценой невозможности запустить другое.
 *
 * Трогает только временную базу прогона. Боевой она не касается ничем.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("нужен DATABASE_URL");
  process.exit(1);
}

const journal = JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8"));
const last = Math.max(...journal.entries.map(e => e.when));

const conn = await mysql.createConnection(url);
try {
  await conn.execute(`
    create table if not exists \`__drizzle_migrations\` (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
  const [rows] = await conn.execute("select count(*) as n from `__drizzle_migrations`");
  if (Number(rows[0].n) > 0) {
    console.log("журнал уже заполнен — ничего не меняю");
  } else {
    await conn.execute(
      "insert into `__drizzle_migrations` (`hash`, `created_at`) values (?, ?)",
      [`e2e-baseline:${journal.entries.length} миграций`, last],
    );
    console.log(`журнал отмечен: ${journal.entries.length} миграций, последняя ${last}`);
  }
} finally {
  await conn.end();
}
