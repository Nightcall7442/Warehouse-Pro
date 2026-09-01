#!/usr/bin/env node
/**
 * Проверить, что ни одна миграция не содержит пустых запросов.
 *
 * ── Зачем ────────────────────────────────────────────────────────────────────
 *
 * drizzle-orm/migrator.js режет файл миграции обычным `query.split("-->
 * statement-breakpoint")` и НЕ отсеивает пустые куски. Всё, что получилось
 * между двумя маркерами, уходит в базу как отдельный запрос — включая кусок,
 * в котором нет ни одного оператора SQL.
 *
 * MySQL на такой запрос отвечает ошибкой 1065 «Query was empty», мигратор
 * бросает исключение, а api/boot.ts на любой сбой миграции делает
 * process.exit(1) — сервер не поднимается вовсе, healthcheck не проходит,
 * выкладка падает целиком.
 *
 * Ровно так упала выкладка 0050_suppliers_and_supplier_debt: файл кончался
 * лишней строкой `--> statement-breakpoint`, из-за чего последним куском
 * оказался один перевод строки. Весь SQL к тому моменту уже применился —
 * упало на пустоте после него.
 *
 * Опасны два вида кусков, и оба выглядят в файле совершенно безобидно:
 *   • пустой или из одних пробелов — обычно лишний маркер в конце файла;
 *   • из одних комментариев — например, два маркера подряд с заголовком
 *     раздела между ними.
 *
 * ── Запуск ───────────────────────────────────────────────────────────────────
 *
 *     node scripts/check-migration-statements.mjs
 *
 * Код возврата 1, если нашлась хоть одна пустая — годится для CI.
 */

import fs from "node:fs";
import path from "node:path";

const DIR = "db/migrations";

/** Убрать комментарии, чтобы понять, остаётся ли в куске хоть один оператор. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")  // блочные /* ... */
    .replace(/^\s*--.*$/gm, "")          // строчные -- ...
    .replace(/^\s*#.*$/gm, "")           // строчные # ...
    .trim();
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();
let bad = 0;

for (const file of files) {
  const sql = fs.readFileSync(path.join(DIR, file), "utf8");
  // Ровно то же разбиение, что делает drizzle-orm/migrator.js.
  const chunks = sql.split("--> statement-breakpoint");

  chunks.forEach((chunk, i) => {
    if (stripComments(chunk) === "") {
      bad++;
      const where = i === chunks.length - 1 ? "в конце файла" : `кусок №${i + 1} из ${chunks.length}`;
      console.error(`${file}: пустой запрос — ${where}`);
    }
  });
}

if (bad > 0) {
  console.error(
    `\nНайдено пустых запросов: ${bad}.\n` +
    `Мигратор отправит их в базу как есть и получит «Query was empty» (1065),\n` +
    `а boot.ts на сбой миграции выходит с ошибкой — выкладка упадёт целиком.\n` +
    `Уберите лишний маркер --> statement-breakpoint.`,
  );
  process.exit(1);
}

console.log(`Проверено файлов: ${files.length}. Пустых запросов нет.`);
