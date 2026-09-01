/**
 * Настоящая MySQL для тестов.
 *
 * ── Зачем, если есть стенд на заглушках ─────────────────────────────────────
 *
 * Затем, что заглушка врёт по построению, и врёт именно там, где живут
 * денежные баги. В её разборщике условий стоят два «всегда истина»:
 *
 *   • сырой `sql`…`` считается выполненным не глядя — а это ВСЕ условия вида
 *     `IN (…)` и весь `FOR UPDATE`;
 *   • колонка, которой нет в строке стенда, считается совпавшей.
 *
 * Из этого следует, что на заглушке нельзя проверить ни одну блокировку, ни
 * один уникальный индекс, ни одну гонку. Сегодня я дважды отказался писать
 * проверку по этой причине: она прошла бы при любом коде.
 *
 * Здесь база настоящая, миграции те же 47 файлов, что накатывает приложение
 * при старте, тем же `migrate()` из drizzle. Проверяется то, чего заглушка не
 * умеет в принципе.
 *
 * ── Как запускать ───────────────────────────────────────────────────────────
 *
 * Нужна переменная TEST_DATABASE_URL с адресом ПУСТОЙ базы, которую не жалко:
 * стенд её вычищает между тестами.
 *
 *     docker run --rm -d -p 3307:3306 \
 *       -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=warehouse_test mysql:8
 *     TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3307/warehouse_test npm run test:db
 *
 * Файлы этого набора идут ПОСЛЕДОВАТЕЛЬНО (--no-file-parallelism в
 * package.json). База у них одна на всех, и truncateAll() одного файла вытер
 * бы данные другого прямо посреди его теста; а на старте оба разом полезли бы
 * накатывать миграции. Поймано ровно так: второй файл в наборе — и прогон
 * развалился.
 *
 * Без переменной набор пропускается — с громкой строкой в выводе, а не молча.
 * Молчаливый пропуск неотличим от прохождения, и через месяц никто не
 * помнит, что эти тесты вообще есть.
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@db/schema";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
export const hasRealDb = TEST_DATABASE_URL.length > 0;

/**
 * Сервисы принимают `db` того типа, который отдаёт getDb(). Собранный здесь
 * экземпляр устроен так же, но вывод типов drizzle этого не показывает —
 * приведение названо, а не рассыпано по вызовам.
 */
export type ServiceDb = Parameters<typeof import("../../services/order").OrderService.create>[0];

type TestDb = ReturnType<typeof drizzle>;

let pool: mysql.Pool | null = null;
let db: TestDb | null = null;

/** Таблицы, которые чистятся между тестами. Порядок не важен: ключи сняты. */
const TABLES = [
  "order_items", "orders", "payments", "notifications", "warehouse_stock",
  "stock_movements", "products", "shops", "warehouses", "users", "tenants",
  // Расчёты с контрагентами: платежи, поставки, сами контрагенты, приходы.
  "supplier_payments", "supplies", "suppliers", "arrival_items", "arrivals",
];

/**
 * Схема ставится ТЕМИ ЖЕ миграциями, что накатывает приложение при старте.
 *
 * Раньше здесь стоял `drizzle-kit push` — сборка схемы прямо из db/schema.ts
 * мимо миграций. Не от хорошей жизни: цепочка из 51 файла на чистую базу не
 * вставала вовсе (0009 ссылалась на колонку, которую добавляет 0012), и
 * отдельный workflow test-migrations был красным всё время своего
 * существования.
 *
 * 1 сентября 2026 историю свернули в один baseline, собранный из
 * db/schema.ts, и накат с нуля заработал. Теперь стенд идёт тем же путём, что
 * и продакшен: если миграция сломается, эти тесты упадут вместе с ней, а не
 * продолжат работать на схеме, собранной в обход.
 */
function applyMigrations(): void {
  execFileSync("npx", ["drizzle-kit", "migrate"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

export async function connectRealDb(): Promise<ServiceDb> {
  if (!hasRealDb) throw new Error("TEST_DATABASE_URL не задан");
  if (!db) {
    applyMigrations();
    pool = mysql.createPool({ uri: TEST_DATABASE_URL, connectionLimit: 10, waitForConnections: true });
    // Приведение — то же, что в api/queries/connection.ts: вывод типов drizzle
    // не разворачивается, когда схема передана целиком, хотя в рантайме всё
    // на месте. Названо здесь один раз, а не рассыпано по вызовам.
    db = drizzle(pool, { schema, mode: "default" }) as unknown as TestDb;
  }
  return db as unknown as ServiceDb;
}

export async function closeRealDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

/** Пустая база перед каждым тестом: гонки чувствительны к остаткам данных. */
export async function truncateAll(): Promise<void> {
  if (!db) return;
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  for (const table of TABLES) {
    // Имена таблиц — из списка выше, а не из данных: подстановки здесь нет.
    await db.execute(sql.raw(`TRUNCATE TABLE \`${table}\``));
  }
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
}

export interface Seeded {
  tenantId: number;
  otherTenantId: number;
  agentId: number;
  shopId: number;
  productId: number;
  warehouseId: number;
}

/**
 * Минимальный набор данных: организация, склад, агент, магазин, товар и
 * остаток. Плюс вторая организация — чтобы было чему протечь.
 */
export async function seed(stock: string = "10.000"): Promise<Seeded> {
  const d = db!;

  const [tenant] = await d.insert(schema.tenants)
    .values({ slug: "test-co", name: "Тестовая компания" });
  const tenantId = Number(tenant.insertId);

  const [other] = await d.insert(schema.tenants)
    .values({ slug: "other-co", name: "Соседняя компания" });
  const otherTenantId = Number(other.insertId);

  const [warehouse] = await d.insert(schema.warehouses)
    .values({ tenantId, name: "Основной", isDefault: true });
  const warehouseId = Number(warehouse.insertId);

  const [agent] = await d.insert(schema.users).values({
    tenantId, name: "Агент", email: "agent@test.local",
    passwordHash: "x", role: "agent",
  });
  const agentId = Number(agent.insertId);

  const [shop] = await d.insert(schema.shops)
    .values({ tenantId, name: "Магазин Альфа" });
  const shopId = Number(shop.insertId);

  const [product] = await d.insert(schema.products)
    .values({ tenantId, code: "P-1", name: "Товар", unitPrice: "100.00" });
  const productId = Number(product.insertId);

  await d.insert(schema.warehouseStock).values({
    tenantId, productId, warehouseId,
    currentStock: stock, reserved: "0.000", available: stock,
  });

  return { tenantId, otherTenantId, agentId, shopId, productId, warehouseId };
}

/** Остаток товара как он лежит в базе — для проверки инварианта. */
export async function stockOf(productId: number): Promise<{ current: number; reserved: number; available: number }> {
  const rows = await db!.execute(sql`
    SELECT current_stock AS c, reserved AS r, available AS a
    FROM warehouse_stock WHERE product_id = ${productId} LIMIT 1
  `);
  const [list] = rows as unknown as [Array<Record<string, unknown>>, unknown];
  const row = list[0] ?? {};
  return { current: Number(row.c ?? 0), reserved: Number(row.r ?? 0), available: Number(row.a ?? 0) };
}

/** Сколько строк в таблице — короткая форма для ожиданий. */
export async function countOf(table: string, where = "1=1"): Promise<number> {
  const rows = await db!.execute(sql.raw(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`));
  const [list] = rows as unknown as [Array<Record<string, unknown>>, unknown];
  return Number(list[0]?.n ?? 0);
}
