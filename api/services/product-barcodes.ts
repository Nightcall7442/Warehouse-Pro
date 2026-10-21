/**
 * Дополнительные штрих-коды товара.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * У товара был один штрих-код. Тот же сок приходит от второго поставщика со
 * своей этикеткой, пачка и блок сканируются разными кодами, новая партия
 * приходит с новым кодом — и сканер на приходе, в инвентаризации и в заказе
 * отвечал «не найден». Человек заводил второй товар-двойник, и остаток
 * расползался по двум карточкам.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Основной штрих-код остаётся в products.barcode: его печатают этикетки, его
 * отдают публичный API и выгрузки. Дополнительные лежат в product_barcodes.
 * Один код ведёт к одному товару: дополнительный не может совпасть ни с
 * чужим дополнительным (уникальный индекс), ни с чужим основным, а основной —
 * с чужим дополнительным (проверка здесь: основной исторически не уникален,
 * и индексом эти две колонки не связать).
 *
 * Поиск по скану ранжирован: совпадение по основному штрих-коду выше
 * совпадения по дополнительному. Старые совпадения основных между собой
 * (они бывают в живых данных) этим не лечатся, но и не становятся хуже.
 */
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { productBarcodes, products } from "@db/schema";
import { isDuplicateOf } from "../lib/db-errors";

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Сколько дополнительных кодов у одного товара: блок, пачка, пара поставщиков. */
export const MAX_EXTRA_BARCODES = 20;

/** Сравнение — как у базы: без регистра (колонка в регистронезависимой сортировке). */
export const barcodeKey = (code: string) => code.trim().toLowerCase();
const key = barcodeKey;

/**
 * Дополнительные коды в том виде, в каком их хранить: без пробелов по краям,
 * без пустых, без повторов и без самого основного — он и так находит товар.
 */
export function cleanExtraBarcodes(main: string | null | undefined, extras: readonly string[]): string[] {
  const seen = new Set<string>(main && main.trim() ? [key(main)] : []);
  const out: string[] = [];
  for (const raw of extras) {
    const code = raw.trim();
    if (!code || seen.has(key(code))) continue;
    seen.add(key(code));
    out.push(code);
  }
  return out;
}

/**
 * Условие «у товара есть такой дополнительный код».
 *
 * Подзапросом по (tenant_id, barcode) — это ровно уникальный индекс, и он
 * работает; EXISTS с корреляцией по товару заставил бы базу перебирать
 * товары.
 */
export function hasExtraBarcode(tenantId: number, code: string): SQL {
  return sql`${products.id} IN (SELECT pb.product_id FROM product_barcodes pb WHERE pb.tenant_id = ${tenantId} AND pb.barcode = ${code})`;
}

/** Порядок выдачи по скану: сначала совпадение по основному штрих-коду. */
export function mainBarcodeFirst(code: string): SQL {
  return sql`CASE WHEN ${products.barcode} = ${code} THEN 0 ELSE 1 END`;
}

/**
 * Дополнительные коды по товарам — одним запросом на весь список.
 *
 * productIds — только эти товары (пустой список — пусто, без похода в базу);
 * null — все товары организации.
 */
export async function extraBarcodesOf(db: Db | Tx, tenantId: number, productIds: readonly number[] | null): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (productIds && productIds.length === 0) return out;
  const rows = await db.select({ productId: productBarcodes.productId, barcode: productBarcodes.barcode })
    .from(productBarcodes)
    .where(and(
      eq(productBarcodes.tenantId, tenantId),
      ...(productIds ? [inArray(productBarcodes.productId, [...productIds])] : []),
    ))
    .orderBy(productBarcodes.productId, productBarcodes.id);
  for (const r of rows) {
    const id = Number(r.productId);
    const list = out.get(id);
    if (list) list.push(r.barcode); else out.set(id, [r.barcode]);
  }
  return out;
}

/** Строке товара — её дополнительные коды; у кого нет — пустой список, а не отсутствие поля. */
export function withBarcodes<T extends { id: number | string }>(rows: readonly T[], extras: Map<number, string[]>): Array<T & { barcodes: string[] }> {
  return rows.map(r => ({ ...r, barcodes: extras.get(Number(r.id)) ?? [] }));
}

/**
 * Чьи это дополнительные коды: код (в нижнем регистре) → товар. Для импорта,
 * где проверять приходится сразу сотни строк, а не одну карточку.
 */
export async function extraBarcodeOwners(db: Db | Tx, tenantId: number, codes: readonly string[]): Promise<Map<string, { productId: number; name: string }>> {
  const out = new Map<string, { productId: number; name: string }>();
  const wanted = [...new Set(codes.map(c => c.trim()).filter(Boolean))];
  if (wanted.length === 0) return out;
  const rows = await db.select({ barcode: productBarcodes.barcode, productId: products.id, name: products.name })
    .from(productBarcodes)
    .innerJoin(products, and(eq(products.id, productBarcodes.productId), eq(products.tenantId, tenantId)))
    .where(and(eq(productBarcodes.tenantId, tenantId), inArray(productBarcodes.barcode, wanted)));
  for (const r of rows) out.set(key(r.barcode), { productId: Number(r.productId), name: r.name });
  return out;
}

/** Отказ называет код и товар, у которого он уже стоит: искать по номеру товара человеку нечем. */
function busy(code: string, owner: string): never {
  throw new TRPCError({
    code: "CONFLICT",
    message: `Штрих-код «${code}» уже стоит у товара «${owner}». Уберите его там или укажите другой.`,
  });
}

/**
 * Один код — один товар: проверка перед записью.
 *
 * productId — товар, которому коды ставят (null — товар ещё не заведён);
 * его собственные коды конфликтом не считаются. main — основной штрих-код,
 * если его ставят; extras — дополнительные, уже очищенные.
 */
export async function assertBarcodesFree(
  db: Db | Tx, tenantId: number, productId: number | null,
  codes: { main?: string | null; extras?: readonly string[] },
): Promise<void> {
  const notThis = productId != null ? [ne(products.id, productId)] : [];
  const extras = [...(codes.extras ?? [])];

  if (extras.length > 0) {
    // Дополнительный против чужого основного.
    const [asMain] = await db.select({ barcode: products.barcode, name: products.name })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.barcode, extras), ...notThis))
      .limit(1);
    if (asMain?.barcode) busy(asMain.barcode, asMain.name);

    // Дополнительный против чужого дополнительного — индекс бы тоже не дал,
    // но назвать товар может только этот запрос.
    const owners = await extraBarcodeOwners(db, tenantId, extras);
    for (const code of extras) {
      const owner = owners.get(key(code));
      if (owner && owner.productId !== productId) busy(code, owner.name);
    }
  }

  const main = codes.main?.trim();
  if (main) {
    // Основной против чужого дополнительного.
    const owner = (await extraBarcodeOwners(db, tenantId, [main])).get(key(main));
    if (owner && owner.productId !== productId) busy(main, owner.name);
  }
}

/**
 * Заменить дополнительные коды товара целиком — внутри транзакции правки.
 *
 * Пересечения проверяет assertBarcodesFree до вызова; уникальный индекс
 * здесь — последний рубеж на случай гонки двух правок одновременно.
 */
export async function replaceExtraBarcodes(tx: Db | Tx, tenantId: number, productId: number, extras: readonly string[]): Promise<void> {
  await tx.delete(productBarcodes)
    .where(and(eq(productBarcodes.tenantId, tenantId), eq(productBarcodes.productId, productId)));
  if (extras.length === 0) return;
  try {
    await tx.insert(productBarcodes).values(extras.map(barcode => ({ tenantId, productId, barcode })));
  } catch (e) {
    if (isDuplicateOf(e, "uq_product_barcode_tenant")) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Этот штрих-код только что поставили другому товару. Обновите карточку и проверьте коды.",
      });
    }
    throw e;
  }
}
