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

/**
 * Индексы, известные как неописанные в schema.ts.
 *
 * Пуст с 01.09.2026, и это не «список забыли почистить». Историю миграций
 * свернули в один baseline, собранный drizzle-kit ИЗ db/schema.ts, — значит
 * индекса, которого нет в модели, в миграциях взяться неоткуда, и расхождение
 * закрыто по построению.
 *
 * Двадцать три записи, стоявшие здесь раньше, разошлись надвое. Пять
 * (idx_orders_courier_date, idx_orders_deleted_at, idx_orders_payment_method,
 * idx_returns_agent_date, idx_visit_reports_user_date) объявлены в schema.ts
 * теми же именами: без этого baseline не создал бы их на новой установке, и
 * та молча осталась бы без индексов, которые на бою есть. Остальные исчезли
 * вместе со старыми файлами — они либо дублировали объявленные под другими
 * именами, либо описывали объекты, которых в модели нет.
 *
 * Проверка остаётся в силе: стоит написать миграцию руками и создать в ней
 * индекс мимо модели — она это увидит.
 */
const KNOWN_UNDECLARED = new Set<string>([]);

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
  // Кавычки в schema.ts встречаются и двойные, и одинарные:
  // index("idx_orders_tenant") рядом с index('idx_sync_status_tenant').
  // Проверка только по двойным считала одинарные необъявленными — так
  // idx_sync_status_tenant и idx_sync_status_entity попали в список
  // известного расхождения, хотя описаны были всегда. Ложное срабатывание
  // прикрыли записью в списке вместо того, чтобы починить разбор.
  const declared = (name: string) => schema.includes(`"${name}"`) || schema.includes(`'${name}'`);
  const undeclared = [...indexesInMigrations()].filter(name => !declared(name)).sort();

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
    // Порог держится и на одном файле: baseline создаёт всю схему разом, и
    // индексов в нём больше двух сотен. Если разбор миграций сломается и
    // вернёт пустое множество, обе проверки выше пройдут вхолостую.
    expect(indexesInMigrations().size).toBeGreaterThan(50);
  });
});
