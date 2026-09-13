/**
 * Перенос фото называет только существующие колонки.
 *
 * Стояло `returns.return_photos` — а фото возврата лежат на строке заказа.
 * Работа падала каждую ночь на первом же запросе к несуществующей колонке;
 * стенд этого не видел, потому что подделка базы отвечает на любой SELECT.
 * Здесь список сверяется с db/schema.ts как с текстом: таблица есть, колонка
 * в ней есть, а у таблицы без tenant_id указано, откуда брать арендатора.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SINGLE, LISTS } from "../services/photo-offload";

const schema = readFileSync(join(process.cwd(), "db", "schema.ts"), "utf8");

function tableBody(name: string): string | null {
  const start = schema.indexOf(`mysqlTable("${name}"`);
  if (start < 0) return null;
  const end = schema.indexOf("\n});", start);
  return schema.slice(start, end > 0 ? end : undefined);
}

describe("колонки переноса фото", () => {
  for (const entry of [...SINGLE, ...LISTS]) {
    it(`${entry.table}.${entry.column} есть в схеме`, () => {
      const body = tableBody(entry.table);
      expect(body, `таблицы ${entry.table} нет в db/schema.ts`).not.toBeNull();
      expect(body, `в ${entry.table} нет колонки ${entry.column}`).toMatch(new RegExp(`\\("${entry.column}"`));
      const hasTenant = body!.includes('"tenant_id"');
      const via = "tenant" in entry && entry.tenant !== undefined;
      expect(hasTenant || via, `${entry.table}: нет tenant_id и не сказано, откуда брать арендатора`).toBe(true);
    });
  }
});
