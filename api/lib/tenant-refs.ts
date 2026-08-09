import { inArray, and, eq } from "drizzle-orm";
import { products } from "@db/schema";
import { TRPCError } from "@trpc/server";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/**
 * Проверить, что товары из запроса принадлежат этой организации.
 *
 * Ссылки на товар приходят от клиента, а таблица products общая для всей
 * платформы. Записав чужой product_id в свою строку — прайс-листа, возврата,
 * остатка — и прочитав её обратно, можно получить название, код и цену товара
 * другой компании. Перебором так выгружается чужой каталог целиком, а вместе с
 * ним и прайс.
 *
 * Проверка одним запросом, а не по одному на товар: в прайс-лист и в возврат
 * приходят десятки строк, и цикл с отдельным SELECT на каждую превратил бы
 * защиту в самую медленную часть операции — а значит в кандидата на удаление
 * при первой же жалобе на скорость.
 *
 * Это лишь половина защиты. Вторая — условие по организации в соединениях на
 * чтении: в базе уже могут лежать ссылки, записанные до появления проверки, и
 * доверять им молча нельзя.
 */
export async function assertProductsBelongToTenant(
  db: Db,
  tenantId: number,
  productIds: number[],
): Promise<void> {
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return;

  const found = await db.select({ id: products.id }).from(products)
    .where(and(inArray(products.id, unique), eq(products.tenantId, tenantId)));

  const known = new Set(found.map(r => r.id));
  const foreign = unique.filter(id => !known.has(id));
  if (foreign.length > 0) {
    // Названия чужого товара в ответе быть не должно — иначе сообщение об
    // ошибке само станет тем каналом утечки, который мы закрываем.
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: foreign.length === 1
        ? `Товар #${foreign[0]} не найден в вашей организации`
        : `Не найдены товары вашей организации: ${foreign.slice(0, 10).join(", ")}`,
    });
  }
}
