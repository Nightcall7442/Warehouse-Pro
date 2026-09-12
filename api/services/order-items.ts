import { eq, and, isNull, inArray } from "drizzle-orm";
import { orders, orderItems, warehouseStock, products } from "@db/schema";
import { resolvePrices } from "./price-resolver";
import { cache, CacheKeys } from "../lib/cache";
import type { Db, AuditActor } from "./order-shared";
import { resolveOrderWarehouse, settleShopDebt, stockModeFor, productLabel, applyStockDelta, traceOrderChange } from "./order-shared";

export async function update(
  db: Db, tenantId: number, orderId: number,
  data: {
    notes?: string; discount?: string;
    paymentMethod?: "cash" | "card" | "transfer" | "debt";
    /*
      null здесь означает «обещание снято», а undefined — «не трогали».
      Свести их в одно нельзя: без различия снять ошибочно поставленный срок
      было бы нечем.
    */
    promisedDeliveryAt?: Date | null;
  },
  actor?: AuditActor,
) {
  // discount is a percentage (0-100), same contract as OrderService.create.
  if (data.discount !== undefined) {
    const pct = Number(data.discount);
    // NaN не меньше нуля и не больше ста — без этой строки он проходил обе
    // проверки, и заказ пересчитывался в «NaN».
    if (!Number.isFinite(pct)) throw new Error("Скидка должна быть числом");
    if (pct < 0) throw new Error("Скидка не может быть отрицательной");
    if (pct > 100) throw new Error("Скидка не может превышать 100%");
  }

  await db.transaction(async (tx) => {
    const [order] = await tx.select({
      id: orders.id,
      status: orders.status,
      subtotal: orders.subtotal,
      total: orders.total,
      shopId: orders.shopId,
      paymentMethod: orders.paymentMethod,
      deletedAt: orders.deletedAt,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
      // Под замком: субтотал и статус читаются здесь, а пишутся ниже. Без
      // замка курьер, закрывающий этот же заказ в телефоне, успевал между
      // чтением и записью — скидка пересчитывалась от старой суммы.
      .for("update")
      .limit(1);
    if (!order) throw new Error("Заказ не найден");

    const updates: Record<string, unknown> = {};
    if (data.notes !== undefined) updates.notes = data.notes;

    let newTotal = Number(order.total);
    if (data.discount !== undefined) {
      const subtotal = Number(order.subtotal);
      const discount = subtotal * (Number(data.discount) / 100);
      newTotal = subtotal - discount;
      updates.discount = discount.toFixed(2);
      updates.total = newTotal.toFixed(2);
    }
    if (data.paymentMethod !== undefined) updates.paymentMethod = data.paymentMethod;
    /*
      Обещанный срок. Проверяется именно на `undefined`, а не на «пусто»:
      null означает «обещание снято» и обязан дойти до базы, иначе снять
      ошибочно поставленный срок было бы нечем.
    */
    if (data.promisedDeliveryAt !== undefined) updates.promisedDeliveryAt = data.promisedDeliveryAt;

    if (Object.keys(updates).length > 0) {
      await tx.update(orders).set(updates).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));
    }
    // Re-discounting and switching to/from "в долг" both change what this
    // order owes; re-deriving covers either without case analysis.
    await settleShopDebt(tx, tenantId, order.shopId);
  });

  cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));
  // Только денежные поля: заметки и срок доставки долга не меняют.
  if (data.discount !== undefined || data.paymentMethod !== undefined) {
    await traceOrderChange(db, tenantId, orderId, "order.update", actor, {
      ...(data.discount !== undefined ? { discountPct: Number(data.discount) } : {}),
      ...(data.paymentMethod !== undefined ? { paymentMethod: data.paymentMethod } : {}),
    });
  }

  return { success: true };
}

/**
 * Rewrites an order's lines: quantities, unit prices, added and removed
 * products. Lines are matched by `itemId`; an entry without one adds a new
 * product, and `quantity: 0` drops the line.
 *
 * Editing is allowed in any status, so stock is moved according to what the
 * current status already did to it (see stockModeFor): a "new" order shifts
 * its reservation, while a delivered one adjusts stock actually on hand.
 * Omitting `items` entirely leaves the lines untouched.
 */

export async function updateItems(
  db: Db, tenantId: number, orderId: number,
  data: { items: Array<{ itemId?: number; productId?: number; quantity: number; unitPrice?: string }> },
  actor?: AuditActor,
) {
  // TS сужает let-переменную до never после замыкания; объект с полями обходит это.
  const totals: { before?: string; after?: string } = {};
  await db.transaction(async (tx) => {
    const [order] = await tx.select({
      id: orders.id, status: orders.status, shopId: orders.shopId,
      subtotal: orders.subtotal, total: orders.total, discount: orders.discount,
      paymentMethod: orders.paymentMethod, deletedAt: orders.deletedAt,
    }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), isNull(orders.deletedAt)))
      // Под замком до выбора режима склада. Без него: T1 (правка состава)
      // читает status=new, T2 (updateStatus new→delivered) блокирует заказ,
      // списывает и коммитит; T1 дожидается замков остатка и резервирует
      // под уже доставленный заказ — магазин должен за 15, уехало 10, пять
      // единиц висят в reserved без заказа, который бы их объяснял.
      .for("update")
      .limit(1);
    if (!order) throw new Error("Заказ не найден");

    const mode = stockModeFor(order.status);
    const whId = await resolveOrderWarehouse(tx, tenantId);
    const existingItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const existingById = new Map(existingItems.map(i => [i.id, i]));

    // Состав частично доставленного заказа этой функцией не правится.
    //
    // Здесь считается только quantity — заказанное. У заказа, по которому
    // курьер отдал часть и часть вернул, доставленное лежит отдельно, в
    // delivered_quantity, и оно тут не читается вовсе. Поэтому сохранение —
    // даже без единой правки, просто «открыл и нажал сохранить», а веб
    // отправляет все строки целиком — пересчитывало сумму заказа по
    // ЗАКАЗАННОМУ и возвращало магазину в долг стоимость товара, который он
    // уже вернул. Попытка исправить это руками, поставив доставленное
    // количество, зачисляла возвращённые единицы на склад второй раз:
    // applyStockDelta в режиме consumed трактует уменьшение как возврат.
    //
    // Правильный инструмент для такого заказа — документ возврата или
    // повторная отметка доставки, где доставленное и есть предмет разговора.
    // Отказ здесь честнее, чем попытка угадать намерение в функции с пятью
    // ветками: цифры расходятся молча, а разбирать их потом по бумагам.
    const partiallyDelivered = existingItems.find(i => i.deliveredQuantity !== null);
    if (partiallyDelivered) {
      throw new Error(
        "Заказ уже частично доставлен — состав менять нельзя. " +
        "Оформите возврат или переотметьте доставку: там учитывается доставленное количество.",
      );
    }

    // Validate that every new product belongs to this tenant before touching
    // anything — an unknown id must not leave the order half-rewritten.
    const newProductIds = data.items.filter(i => i.itemId === undefined).map(i => i.productId);
    if (newProductIds.some(id => id === undefined)) {
      throw new Error("Для новой позиции нужно указать товар");
    }
    const productPrices = new Map<number, { costPrice: string; unitPrice: string; priceListId: number | null }>();
    if (newProductIds.length > 0) {
      const found = await tx.select({ id: products.id, costPrice: products.costPrice, unitPrice: products.unitPrice })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), inArray(products.id, newProductIds as number[])));
      const fallback = new Map(found.map(p => [Number(p.id), p.unitPrice]));
      // Новая строка без цены от оператора берёт цену магазина (прайс-лист),
      // иначе карточки — а не ноль, как было.
      const newLines = data.items.filter(i => i.itemId === undefined).map(i => ({ productId: i.productId as number, quantity: i.quantity }));
      const resolved = await resolvePrices(tx, tenantId, order.shopId, newLines, fallback);
      for (const p of found) {
        const r = resolved.get(Number(p.id));
        productPrices.set(Number(p.id), { costPrice: p.costPrice, unitPrice: r?.price ?? p.unitPrice, priceListId: r?.priceListId ?? null });
      }
      for (const id of newProductIds as number[]) {
        if (!productPrices.has(id)) throw new Error(`Товар #${id} не найден в вашей организации`);
      }
    }

    // Lock every stock row this edit can touch, in one pass, before any write.
    const touchedProductIds = [...new Set([
      ...existingItems.map(i => i.productId),
      ...(newProductIds as number[]),
    ])];
    for (const productId of touchedProductIds) {
      await tx.select({ id: warehouseStock.id }).from(warehouseStock)
        .where(and(eq(warehouseStock.productId, productId), eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, whId)))
        .for("update");
    }

    const keptItemIds = new Set<number>();
    let newSubtotal = 0;

    for (const line of data.items) {
      if (line.quantity < 0) throw new Error("Количество не может быть отрицательным");

      // ── Existing line ──
      if (line.itemId !== undefined) {
        const item = existingById.get(line.itemId);
        if (!item) throw new Error(`Позиция заказа #${line.itemId} не найдена`);

        const oldQty = Number(item.quantity);
        const unitPrice = line.unitPrice !== undefined ? Number(line.unitPrice) : Number(item.unitPrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Цена не может быть отрицательной");

        if (line.quantity === 0) {
          await applyStockDelta(tx, tenantId, whId, item.productId, -oldQty, mode);
          await tx.delete(orderItems).where(eq(orderItems.id, item.id));
          continue;
        }

        keptItemIds.add(item.id);
        await applyStockDelta(tx, tenantId, whId, item.productId, line.quantity - oldQty, mode);
        await tx.update(orderItems).set({
          quantity: String(line.quantity),
          unitPrice: unitPrice.toFixed(2),
          subtotal: (unitPrice * line.quantity).toFixed(2),
        }).where(eq(orderItems.id, item.id));

        newSubtotal += unitPrice * line.quantity;
        continue;
      }

      // ── New line ──
      if (line.quantity === 0) continue;
      const productId = line.productId as number;
      const unitPrice = Number(line.unitPrice ?? productPrices.get(productId)!.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Цена не может быть отрицательной");

      // Товар, который в заказе уже есть, второй строкой не заводится.
      //
      // Второй ряд с тем же product_id ломает всё, что двигает склад по
      // заказу: и здесь, и в updateStatus, cancel, delete, restore резерв
      // собирается одним UPDATE с `CASE WHEN product_id = ...`, а MySQL берёт
      // первый совпавший WHEN — вторая строка молча не резервируется. С
      // миграции 0043 такую пару отвергает и уникальный индекс, но отказ базы
      // выглядел бы как непонятная поломка, поэтому причина называется здесь.
      //
      // Отказ, а не слияние — сознательно. Слить пришлось бы с учётом того,
      // что ту же строку мог править другой элемент этого же вызова (по
      // itemId), и тогда количество считалось бы от устаревшей копии, а сумма
      // задваивалась. В функции с пятью ветками правильнее назвать конфликт,
      // чем угадывать намерение: у вызывающего уже есть itemId нужной строки.
      const already = existingItems.find(i => i.productId === productId);
      if (already) {
        throw new Error(
          `«${await productLabel(tx, tenantId, productId)}» уже есть в заказе — измените количество существующей позиции, а не добавляйте вторую`,
        );
      }

      await applyStockDelta(tx, tenantId, whId, productId, line.quantity, mode);
      await tx.insert(orderItems).values({
        orderId,
        productId,
        quantity: String(line.quantity),
        unitPrice: unitPrice.toFixed(2),
        costPrice: productPrices.get(productId)?.costPrice ?? "0.00",
        subtotal: (unitPrice * line.quantity).toFixed(2),
        // Источник цены пишется только когда цена не задана оператором руками.
        priceListId: line.unitPrice === undefined ? (productPrices.get(productId)?.priceListId ?? null) : null,
      });

      newSubtotal += unitPrice * line.quantity;
    }

    // Lines the caller did not mention stay as they are and still count.
    for (const item of existingItems) {
      if (keptItemIds.has(item.id)) continue;
      if (data.items.some(l => l.itemId === item.id)) continue; // removed above
      newSubtotal += Number(item.unitPrice) * Number(item.quantity);
    }

    if (newSubtotal <= 0) throw new Error("В заказе должна остаться хотя бы одна позиция");

    // Keep the discount proportional to the order's new size.
    const discountPct = Number(order.subtotal) > 0 ? (Number(order.discount) / Number(order.subtotal)) * 100 : 0;
    const newDiscount = newSubtotal * (discountPct / 100);
    const newTotal = newSubtotal - newDiscount;
    totals.before = String(order.total); totals.after = newTotal.toFixed(2);

    await tx.update(orders).set({
      subtotal: newSubtotal.toFixed(2),
      discount: newDiscount.toFixed(2),
      total: newTotal.toFixed(2),
    }).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)));

    await settleShopDebt(tx, tenantId, order.shopId);
  });

  cache.invalidate(CacheKeys.dashboardKpis(Number(tenantId)));
  await traceOrderChange(db, tenantId, orderId, "order.update_items", actor, { totalBefore: totals.before, totalAfter: totals.after, lines: data.items.length });
  return { success: true };
}
