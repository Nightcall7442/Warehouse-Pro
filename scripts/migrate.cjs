// Накат миграций тем же migrate() из drizzle-orm, что зовёт сервер при
// запуске (api/boot.ts), — и с причиной падения на экране.
//
// Раньше лежал здесь как «временный отладочный» debug-migrate.cjs с пометкой
// «убрать, когда drizzle-kit migrate заработает сам». Убирать нельзя:
// drizzle-kit 0.31 прячет причину по-прежнему. Его счётчик (renderWithTask)
// ловит ошибку, гасит строку и выходит с кодом 1, ничего не напечатав, — в
// выводе остаётся «Reading config file» и всё. Проверено 29.09.2026 на
// 0.31.11 сломанной миграцией на пустой базе MySQL 9.4.
//
// Поэтому накат с нуля в test-migrations идёт через этот файл, а drizzle-kit
// там же проверяет уже накатанную базу. Первая строка при падении начинается
// с «Error:» — по ней scripts/ci-run.sh находит причину и выносит её в
// пометку, видную без входа в GitHub.
const mysql2 = require("mysql2/promise");
const { drizzle } = require("drizzle-orm/mysql2");
const { migrate } = require("drizzle-orm/mysql2/migrator");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Error: DATABASE_URL не задан");
    process.exit(1);
  }
  const connection = await mysql2.createConnection(url);
  const db = drizzle(connection);
  try {
    await migrate(db, { migrationsFolder: "./db/migrations" });
    console.log("Миграции применены.");
  } catch (err) {
    // Сообщение и причина — первыми: стек длинный, и в хвост пометки
    // (последние 2500 знаков) сообщение от MySQL уже не влезает.
    console.error(`Error: миграция не встала: ${err && err.message}`);
    if (err && err.cause) console.error("Причина:", err.cause);
    console.error(err && err.stack);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
})();
