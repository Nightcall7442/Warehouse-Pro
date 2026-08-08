import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Индексы, существующие в базе, но не описанные в schema.ts.
 *
 * `drizzle-kit generate` сравнивает schema.ts со своим снимком и выписывает
 * разницу. Индекс, созданный миграцией, но отсутствующий в модели, выглядит для
 * него лишним — и в новую миграцию попадёт `DROP INDEX`. То есть очередная
 * безобидная правка схемы способна снести ровно те индексы, ради которых
 * писались миграции 0011 и 0018.
 *
 * Разом описать всё расхождение здесь нельзя: у части индексов состав колонок
 * восстанавливается только чтением SQL, и ошибка в составе так же приведёт к
 * DROP + CREATE. Поэтому фиксируется граница: известное расхождение записано
 * списком, а любое НОВОЕ роняет сборку. Долг не растёт, и каждый новый случай
 * виден в момент появления, а не через полгода в сгенерированной миграции.
 *
 * Убирая индекс из списка, добавьте его в schema.ts — тест это подтвердит.
 */

const MIGRATIONS = join(process.cwd(), "db", "migrations");

/** Индексы, известные как неописанные. Список может только сокращаться. */
const KNOWN_UNDECLARED = new Set([
  "idx_agent_locations_agent_date",
  "idx_at_agent",
  "idx_at_tenant",
  "idx_at_territory",
  "idx_locations_agent_created",
  "idx_movements_tenant_product_created",
  "idx_order_items_order_product",
  "idx_orders_courier_date",
  "idx_orders_deleted_at",
  "idx_orders_payment_method",
  "idx_orders_tenant_payment_created",
  "idx_orders_tenant_status_date",
  "idx_plans_agent_date",
  "idx_products_tenant_category_status",
  "idx_returns_agent_date",
  "idx_sales_targets_shop",
  "idx_shops_tenant_agent_status",
  "idx_shops_territory",
  "idx_stock_product_warehouse_tenant",
  "idx_sync_status_entity",
  "idx_sync_status_tenant",
  "idx_visit_reports_user_date",
  // В базе индекс называется так, а schema.ts объявляет
  // uq_stock_product_warehouse_tenant — при генерации это выйдет парой
  // DROP + CREATE, причём DROP упадёт: от индекса зависит внешний ключ по
  // product_id.
  "uq_stock_product_warehouse",
]);

/**
 * Слова, которые выглядят как имя индекса, но им не являются.
 *
 * `ADD INDEX IF NOT EXISTS foo` даёт «IF» — синтаксис MariaDB, встречающийся в
 * части файлов. Без этого отсева тест докладывал бы о несуществующих индексах и
 * приучал бы читателя себе не верить.
 */
const NOT_INDEX_NAMES = new Set(["IF", "NOT", "EXISTS"]);

/** Имена индексов, живых после всех миграций (созданные минус удалённые). */
function indexesInMigrations(): Set<string> {
  const alive = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort()) {
    // Комментарии убираются до разбора: в этих файлах они по-русски и
    // многословны, и фраза вроде «добавить ключ, чтобы …» давала ложные имена.
    const sql = readFileSync(join(MIGRATIONS, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ");

    const add = (name: string) => { if (!NOT_INDEX_NAMES.has(name.toUpperCase())) alive.add(name); };
    for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+`?(\w+)`?/gi)) add(m[1]);
    for (const m of sql.matchAll(/ADD\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\s+`?(\w+)`?/gi)) add(m[1]);
    for (const m of sql.matchAll(/DROP\s+INDEX\s+`?(\w+)`?/gi)) alive.delete(m[1]);
  }
  return alive;
}

describe("расхождение индексов между базой и schema.ts", () => {
  const schema = readFileSync(join(process.cwd(), "db", "schema.ts"), "utf8");
  const undeclared = [...indexesInMigrations()].filter(name => !schema.includes(`"${name}"`)).sort();

  it("новых неописанных индексов не появилось", () => {
    const fresh = undeclared.filter(n => !KNOWN_UNDECLARED.has(n));
    expect(
      fresh,
      `эти индексы созданы миграцией, но не описаны в schema.ts — следующая генерация выпишет для них DROP INDEX:\n  ${fresh.join("\n  ")}`,
    ).toEqual([]);
  });

  it("список известного расхождения не разошёлся с действительностью", () => {
    // Индекс, описанный в schema.ts, но всё ещё числящийся в списке, — это
    // забытая запись: она будет молча прикрывать следующее расхождение с тем
    // же именем.
    const stale = [...KNOWN_UNDECLARED].filter(n => !undeclared.includes(n)).sort();
    expect(
      stale,
      `эти индексы уже описаны в schema.ts (или исчезли из миграций) — уберите их из KNOWN_UNDECLARED:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("список не пустеет молча", () => {
    // Страховка от «зелёного ни на чём»: если разбор миграций сломается и
    // вернёт пустое множество, обе проверки выше пройдут вхолостую.
    expect(indexesInMigrations().size).toBeGreaterThan(50);
  });
});
