import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Ни одна миграция не должна содержать пустых запросов.
 *
 * drizzle-orm/migrator.js режет файл обычным `query.split("-->
 * statement-breakpoint")` и НЕ отсеивает пустые куски — всё, что оказалось
 * между двумя маркерами, уходит в базу отдельным запросом. MySQL отвечает на
 * пустой запрос ошибкой 1065 «Query was empty», мигратор бросает исключение,
 * а api/boot.ts на любой сбой миграции делает process.exit(1): сервер не
 * поднимается, healthcheck не проходит, выкладка падает целиком.
 *
 * Так упала выкладка 0050_suppliers_and_supplier_debt 01.09.2026. Файл
 * кончался лишней строкой `--> statement-breakpoint`, последним куском
 * оказался один перевод строки. Весь SQL к тому моменту успешно применился —
 * упало ровно на пустоте после него, уже после всей полезной работы.
 *
 * Ни типы, ни линтер, ни локальный прогон тестов этого не видят: файл
 * выглядит нормально, а разбиение происходит только внутри мигратора на
 * живой базе. Поймать можно единственным способом — повторив разбиение здесь.
 */

const DIR = path.resolve(__dirname, "../../db/migrations");

/** Убрать комментарии: кусок из одних комментариев для MySQL тоже пустой. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*#.*$/gm, "")
    .trim();
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();

describe("миграции: пустых запросов быть не должно", () => {
  it("в каталоге вообще есть миграции", () => {
    // Иначе проверка ниже пройдёт на пустом списке и не будет значить ничего.
    // Порог именно «хотя бы одна»: 01.09.2026 историю из 51 файла свернули в
    // один baseline (db/migrations-archive), и прежний порог «больше сорока»
    // сломался бы на верном состоянии.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("0000_baseline.sql");
  });

  it.each(files)("%s", (file) => {
    const sql = fs.readFileSync(path.join(DIR, file), "utf8");
    // Ровно то же разбиение, что делает drizzle-orm/migrator.js.
    const chunks = sql.split("--> statement-breakpoint");
    const empty = chunks
      .map((chunk, i) => ({ chunk, i }))
      .filter(({ chunk }) => stripComments(chunk) === "")
      .map(({ i }) => (i === chunks.length - 1 ? "в конце файла" : `кусок №${i + 1} из ${chunks.length}`));

    expect(empty, `лишний маркер --> statement-breakpoint (${empty.join(", ")})`).toEqual([]);
  });

  it("ловит лишний маркер в конце — встречная проверка", () => {
    // Без неё «пусто» выше не значило бы ничего: правило могло бы не работать
    // вовсе, а тест всё равно был бы зелёным.
    const withTrailingMarker = "CREATE TABLE a (id int);\n--> statement-breakpoint\n";
    const chunks = withTrailingMarker.split("--> statement-breakpoint");
    expect(chunks.filter(c => stripComments(c) === "")).toHaveLength(1);
  });

  it("ловит кусок из одних комментариев — встречная проверка", () => {
    const commentOnly = "SELECT 1;\n--> statement-breakpoint\n-- просто заголовок\n--> statement-breakpoint\nSELECT 2;";
    const chunks = commentOnly.split("--> statement-breakpoint");
    expect(chunks.filter(c => stripComments(c) === "")).toHaveLength(1);
  });
});
