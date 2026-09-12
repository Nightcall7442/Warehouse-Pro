import { warehouseStock, products, warehouses } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { recordAudit } from "./audit-log";
import { recordStockMovement, receiveStock, applyStockEffect, setStock } from "./stock-ledger";
import { TRPCError } from "@trpc/server";

type DrizzleInstance = ReturnType<typeof import("../queries/connection").getDb>;

export interface StockItem {
  productId: number;
  quantity: number;
}

/** Get default warehouse for a tenant. Used when no warehouseId is specified. */
async function getDefaultWarehouseId(db: DrizzleInstance, tenantId: number): Promise<number> {
  const [wh] = await db.select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)))
    .limit(1);
  if (!wh) throw new Error("Склад по умолчанию не найден");
  return wh.id;
}

export const StockService = {
  /*
    Здесь были reserve, release и deduct.

    Три операции, ради которых служба и писалась, — и не вызывал их НИКТО:
    каждый путь менял остаток сам, сырым SQL, по-своему. Написанный и мёртвый
    код опаснее отсутствующего: он выглядит как готовое решение, и следующий
    разработчик либо тратит день, выясняя, почему им не пользуются, либо
    начинает пользоваться и получает четвёртую версию арифметики.

    Теперь всё это живёт в api/services/stock-ledger.ts одним примитивом, и
    зовётся оттуда. Adjust остался: он один и вызывался (ручная корректировка
    со склада), и делает не то же самое — назначает остаток числом с записью
    в журнал и проверкой прав.
  */
  async adjust(
    db: DrizzleInstance,
    tenantId: number,
    productId: number,
    quantity: number,
    type: "in" | "out" | "adjustment",
    notes?: string,
    actor?: { id: number; name: string; ip?: string },
    warehouseId?: number,
  ) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Количество должно быть положительным числом");
    }

    // productId приходит от клиента, а таблица products общая для платформы.
    // Проверки принадлежности здесь не было: оператор организации A вызывал
    // adjustStock с чужим productId, в warehouse_stock появлялась строка
    // tenant_id=A / product_id организации B, и warehouse.list возвращал её
    // вместе с названием, кодом, категорией, ценой и СЕБЕСТОИМОСТЬЮ чужого
    // товара. Перебором id так выгружался чужой прайс и закупочные цены.
    //
    // Правило и текст отказа те же, что в assertProductsBelongToTenant
    // (api/lib/tenant-refs.ts), включая главное: название чужого товара в
    // ответе не называется, иначе сообщение об ошибке само станет тем каналом
    // утечки, который мы закрываем. Проверка сделана здесь запросом на один
    // товар, а не вызовом того хелпера: тот принимает список и строит условие
    // через inArray ради десятков строк прайс-листа, а сюда всегда приходит
    // ровно один товар.
    const [ownProduct] = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId))).limit(1);
    if (!ownProduct) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Товар #${productId} не найден в вашей организации`,
      });
    }

    // Склад тоже приходит снаружи. getDefaultWarehouseId фильтрует по
    // организации, а явно переданный warehouseId раньше не проверялся вовсе —
    // и остаток можно было записать на чужой склад.
    if (warehouseId !== undefined) {
      const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId))).limit(1);
      if (!wh) throw new Error("Склад не найден в вашей организации");
    }

    const whId = warehouseId ?? await getDefaultWarehouseId(db, tenantId);

    let updatedAvailable: string | undefined;
    let productName: string | undefined;
    let adjustmentDiff = 0;

    await db.transaction(async (tx) => {
      const stockWhere = and(
        eq(warehouseStock.productId, productId),
        eq(warehouseStock.tenantId, tenantId),
        eq(warehouseStock.warehouseId, whId),
      );
      let [currentStock] = await tx.select({
        currentStock: warehouseStock.currentStock,
        available: warehouseStock.available,
        reserved: warehouseStock.reserved,
      })
        .from(warehouseStock).where(stockWhere).limit(1).for("update");

      // If no stock row exists, create one
      if (!currentStock) {
        await tx.insert(warehouseStock).values({
          tenantId,
          warehouseId: whId,
          productId,
          currentStock: "0.00",
          reserved: "0.00",
          available: "0.00",
        });
        currentStock = { currentStock: "0.00", available: "0.00", reserved: "0.00" };
      }

      const currentQty = Number(currentStock?.currentStock ?? 0);
      const availableQty = Number(currentStock?.available ?? 0);
      const reservedQty = Number(currentStock?.reserved ?? 0);

      /*
        Три ветки ниже шли мимо двери своим SQL: available поддерживался
        руками, а списание и пересчёт вниз НЕ трогали партии — журнал «что
        сгорает» показывал товар, которого на полке уже нет. Дверь двигает
        обе таблицы одним вызовом.
      */
      if (type === "in") {
        await receiveStock(tx, {
          tenantId, warehouseId: whId, productId, quantity,
          reason: "manual_adjustment", notes,
        });
      } else if (type === "out") {
        // Сверка шла с current_stock, а списывать можно только свободный
        // остаток. При current 100 / reserved 100 / available 0 списание 20
        // единиц боя проходило (100 >= 20) и загоняло available в −20.
        // Инвариант current = available + reserved при этом формально сходится,
        // поэтому ни одна проверка целостности не срабатывала, а всплывало это
        // позже и в другом месте: OrderService.create по такому товару падал с
        // «Некорректный остаток товара на складе. Обратитесь к администратору».
        //
        // В тексте ошибки назван резерв: без него оператор видит на складе сто
        // единиц и не понимает, почему нельзя списать двадцать.
        if (availableQty < quantity) {
          throw new Error(
            `Недостаточно свободного товара на складе (на складе: ${currentQty}, из них ${reservedQty} зарезервировано под заказы; свободно: ${availableQty}, запрошено: ${quantity})`,
          );
        }
        await applyStockEffect(tx, {
          tenantId, warehouseId: whId, items: [{ productId, quantity }],
          shift: { onHand: -1, held: 0 }, reason: "manual_adjustment", notes,
        });

        const [updatedStock] = await tx.select({ available: warehouseStock.available })
          .from(warehouseStock).where(stockWhere).limit(1);
        // Условие по организации и на чтении: в базе могут лежать строки
        // warehouse_stock с чужим product_id, записанные до появления проверки
        // выше, и подставлять в уведомление название чужого товара нельзя.
        const [product] = await tx.select({ name: products.name })
          .from(products).where(and(eq(products.id, productId), eq(products.tenantId, tenantId))).limit(1);

        updatedAvailable = updatedStock?.available;
        productName = product?.name;
      } else {
        // Инвентаризация задаёт новое АБСОЛЮТНОЕ количество. Опустить его ниже
        // резерва нельзя: зарезервированное уже обещано открытым заказам, и
        // пересчёт «было 100, стало 80» при резерве 100 уводил available в −20
        // ровно так же, как списание выше. Резерв назван в тексте, иначе отказ
        // читается как придирка к цифре.
        if (quantity < reservedQty) {
          throw new Error(
            `Новое количество (${quantity}) меньше зарезервированного под заказы (${reservedQty}). Сначала проведите или отмените заказы, занявшие резерв.`,
          );
        }
        const diff = quantity - currentQty;
        await setStock(tx, { tenantId, warehouseId: whId, productId, quantity });
        adjustmentDiff = diff;
      }

      // Приход и списание записали движение сами (дверь). Пересчёт задаёт
      // итог, а не движение: в журнал идёт разница, и только ненулевая —
      // пересчёт, подтвердивший число, движения не выдумывает.
      if (type === "adjustment" && adjustmentDiff !== 0) {
        await recordStockMovement(tx, {
          tenantId, warehouseId: whId, productId,
          type: adjustmentDiff > 0 ? "in" : "out",
          quantity: Math.abs(adjustmentDiff),
          reason: "manual_adjustment", notes,
        });
      }
    });

    // Тревога «ниже точки заказа» здесь больше не шлётся: раньше она стояла
    // только на ручном списании, а отгрузка по заказу молчала. Теперь один
    // крон (services/reorder.ts) смотрит все пути и предупреждает по факту
    // пересечения — ровно раз.
    await recordAudit(db, {
      tenantId,
      actorId: actor?.id,
      actorName: actor?.name,
      action: "stock.adjusted",
      targetType: "product",
      targetId: productId,
      meta: { type, quantity, notes, productName, updatedAvailable },
      ip: actor?.ip,
    });

    return { success: true };
  },
};
