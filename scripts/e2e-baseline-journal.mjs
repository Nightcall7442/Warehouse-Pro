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
 * Поэтому журнал заполняется здесь — по записи на КАЖДУЮ миграцию.
 *
 * Штатному мигратору drizzle хватило бы одной, последней: он сравнивает
 * только created_at (mysql-core/dialect.js: применяются миграции, у которых
 * folderMillis больше последнего created_at). Но следом за ним идёт догон
 * (api/lib/migration-catchup.ts), и тот сверяет журнал построчно: всё, чего
 * нет в таблице, он применяет заново, прощая «уже есть». С одной записью он
 * переигрывал все 57 прежних файлов поверх готовой схемы — и 0052, снимающая
 * orders.warehouse_id, честно снимала колонку, которую 0057 вернула. Сервер
 * стартовал, а первый же заказ падал на «Unknown column 'warehouse_id'».
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
    for (const e of journal.entries) {
      await conn.execute(
        "insert into `__drizzle_migrations` (`hash`, `created_at`) values (?, ?)",
        [`e2e-baseline:${e.tag}`, e.when],
      );
    }
    const last = Math.max(...journal.entries.map(e => e.when));
    console.log(`журнал отмечен: ${journal.entries.length} миграций, последняя ${last}`);
  }
} finally {
  await conn.end();
}
