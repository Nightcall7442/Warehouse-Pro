import { and, eq, desc, inArray, isNull, sql } from "drizzle-orm";
import {
  warehouses, warehouseStock, products, users, settings, orders, orderItems, payments, shops, stockTransfers,
} from "@db/schema";
import { badRequest } from "../lib/errors";
import { sanitizeString } from "../lib/sanitize";
import { verifyPassword } from "../auth/password";
import { transferStock } from "./stock-transfer";
import { applyStockEffect, expiredByProduct } from "./stock-ledger";
import { resolvePrices } from "./price-resolver";
import { recalcShopDebt } from "./shop-debt";
import { mergeDuplicateItems, nextOrderNumber } from "./order-shared";
import { CashService, ACCOUNT } from "./cash";
import { isDuplicateEntry } from "../lib/db-errors";

/*
  Ван-селлинг: продажа с колёс.

  ── Что это ────────────────────────────────────────────────────────────────

  Машина — склад (warehouses.kind = van) с водителем. Утром в неё грузят
  товар перемещением со склада; водитель подтверждает количество своим PIN —
  это его подпись под тем, что он увёз. Днём он продаёт «с машины»: заказ
  рождается доставленным, товар уходит с остатка машины, деньги — как у
  любой доставки (наличные → «на руках», перевод → «в пути»). Вечером
  непроданное возвращается тем же перемещением, а машина пересчитывается:
  что по системе есть, а в кузове нет — недостача, деньгами по цене
  продажи, долгом водителя в кассе — той же дорогой в удержание из зарплаты.

  ── Почему так ─────────────────────────────────────────────────────────────

  Всё на существующих дверях: остаток — через stock-ledger, перемещение —
  документом, деньги — платежом, долг — кассовым документом. Ничего нового
  считать не надо, и ни один отчёт не узнаёт, что товар ехал в машине.
  Заказ с машины помнит склад (orders.warehouseId) и в работу не
  возвращается: его путь не через резерв основного склада.

  Тариф: Pro и Exclusive (пробный — всё). Basic видит тумблер и подсказку.
*/

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Actor = { id: number; name: string; role: string };
const VAN_PLANS = new Set(["trial", "pro", "exclusive"]);
export const VAN_DRIVER_ROLES = ["courier", "agent", "supervisor"] as const;

export function planAllowsVan(plan: string): boolean {
  return VAN_PLANS.has(plan);
}

/** Включён ли ван-селлинг и позволяет ли тариф; отказ называет причину. */
export async function assertVanSelling(db: Db, tenantId: number, plan: string): Promise<void> {
  if (!planAllowsVan(plan)) throw badRequest("Ван-селлинг доступен на тарифах Pro и Exclusive");
  const [row] = await db.select({ on: settings.vanSellingEnabled }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  if (!row?.on) throw badRequest("Ван-селлинг выключен — включите его в Настройках");
}

async function vanOf(db: Db, tenantId: number, vanId: number) {
  const [van] = await db.select({ id: warehouses.id, name: warehouses.name, plate: warehouses.plate, driverId: warehouses.driverId, kind: warehouses.kind, status: warehouses.status })
    .from(warehouses).where(and(eq(warehouses.id, vanId), eq(warehouses.tenantId, tenantId))).limit(1);
  if (!van || van.kind !== "van") throw badRequest("Машина не найдена");
  if (van.status !== "active") throw badRequest(`Машина «${van.name}» выключена`);
  return van;
}

async function mainWarehouse(db: Db, tenantId: number) {
  const [wh] = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
  if (!wh) throw badRequest("Основной склад не найден");
  return wh;
}

/** Подпись водителя: PIN кассы (тот же, что при сдаче наличных) или галочка «расписался на бумаге». */
async function assertDriverSigned(db: Db, tenantId: number, driverId: number | null, input: { pin?: string | null; paperSigned?: boolean }): Promise<Date | null> {
  if (!driverId) throw badRequest("У машины нет водителя — назначьте его в Настройках");
  if (input.paperSigned) return null;
  if (!input.pin) throw badRequest("Водитель подтверждает количество PIN-кодом — или отметьте «расписался на бумаге»");
  const [u] = await db.select({ hash: users.cashPinHash }).from(users).where(and(eq(users.id, driverId), eq(users.tenantId, tenantId))).limit(1);
  if (!u?.hash) throw badRequest("У водителя нет PIN — он заводит его в профиле; пока — подпись на бумаге");
  if (!(await verifyPassword(input.pin, u.hash))) throw badRequest("PIN не подошёл");
  return new Date();
}

export const VanService = {
  /** Машины организации: водитель, что в кузове и почём, последняя загрузка. */
  async list(db: Db, tenantId: number, forUserId?: number) {
    const vans = await db.select({
      id: warehouses.id, name: warehouses.name, plate: warehouses.plate, driverId: warehouses.driverId, status: warehouses.status, driverName: users.name,
    }).from(warehouses).leftJoin(users, eq(users.id, warehouses.driverId))
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.kind, "van"), ...(forUserId ? [eq(warehouses.driverId, forUserId)] : [])))
      .orderBy(warehouses.name);
    if (!vans.length) return [];
    const ids = vans.map(v => v.id);
    const [stock, loads] = await Promise.all([
      db.select({
        warehouseId: warehouseStock.warehouseId,
        items: sql<number>`count(case when ${warehouseStock.currentStock} > 0 then 1 end)`,
        units: sql<number>`coalesce(sum(${warehouseStock.currentStock}), 0)`,
        value: sql<number>`coalesce(sum(${warehouseStock.currentStock} * ${products.unitPrice}), 0)`,
      }).from(warehouseStock).innerJoin(products, eq(products.id, warehouseStock.productId))
        .where(and(eq(warehouseStock.tenantId, tenantId), inArray(warehouseStock.warehouseId, ids)))
        .groupBy(warehouseStock.warehouseId),
      db.select({ warehouseId: stockTransfers.toWarehouseId, at: sql<Date>`max(${stockTransfers.createdAt})` }).from(stockTransfers)
        .where(and(eq(stockTransfers.tenantId, tenantId), inArray(stockTransfers.toWarehouseId, ids)))
        .groupBy(stockTransfers.toWarehouseId),
    ]);
    const stockOf = new Map(stock.map(s => [Number(s.warehouseId), s]));
    const loadOf = new Map(loads.map(l => [Number(l.warehouseId), l.at]));
    return vans.map(v => ({
      ...v,
      items: Number(stockOf.get(v.id)?.items ?? 0), units: Number(stockOf.get(v.id)?.units ?? 0),
      value: Math.round(Number(stockOf.get(v.id)?.value ?? 0) * 100) / 100,
      lastLoadAt: loadOf.get(v.id) ?? null,
    }));
  },

  /** Завести или поправить машину. Водитель — курьер, агент или супервайзер этой организации. */
  async save(db: Db, tenantId: number, actor: Actor, input: { id?: number; name: string; plate?: string | null; driverId?: number | null; status?: "active" | "inactive" }) {
    const name = sanitizeString(input.name);
    if (!name) throw badRequest("У машины должно быть название");
    if (input.driverId) {
      const [d] = await db.select({ id: users.id, role: users.role, status: users.status }).from(users)
        .where(and(eq(users.id, input.driverId), eq(users.tenantId, tenantId))).limit(1);
      if (!d || !(VAN_DRIVER_ROLES as readonly string[]).includes(d.role) || d.status !== "active") throw badRequest("Водителем может быть активный курьер, агент или супервайзер");
    }
    const plate = input.plate ? sanitizeString(input.plate).toUpperCase().slice(0, 20) : null;
    let id = input.id ?? 0;
    if (input.id) {
      await vanOf(db, tenantId, input.id).catch(() => { throw badRequest("Машина не найдена"); });
      await db.update(warehouses).set({ name, plate, driverId: input.driverId ?? null, ...(input.status ? { status: input.status } : {}) })
        .where(and(eq(warehouses.id, input.id), eq(warehouses.tenantId, tenantId), eq(warehouses.kind, "van")));
    } else {
      const [r] = await db.insert(warehouses).values({ tenantId, name, plate, driverId: input.driverId ?? null, kind: "van", isDefault: false });
      id = Number(r.insertId);
    }
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: input.id ? "van.updated" : "van.created", targetType: "warehouse", targetId: id, targetLabel: name, meta: { plate, driverId: input.driverId ?? null, status: input.status ?? "active" } });
    return { id };
  },

  /** Что в кузове сейчас: по товарам, с ценой продажи и годным остатком. */
  async stock(db: Db, tenantId: number, vanId: number) {
    await vanOf(db, tenantId, vanId);
    const rows = await db.select({
      productId: products.id, name: products.name, code: products.code, unit: products.unit, unitPrice: products.unitPrice,
      onHand: warehouseStock.currentStock, available: warehouseStock.available,
    }).from(warehouseStock).innerJoin(products, eq(products.id, warehouseStock.productId))
      .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, vanId), sql`${warehouseStock.currentStock} > 0`))
      .orderBy(products.name);
    const expired = await expiredByProduct(db, tenantId, vanId, rows.map(r => r.productId));
    return rows.map(r => ({
      ...r, onHand: Number(r.onHand), available: Number(r.available), unitPrice: Number(r.unitPrice),
      sellable: Math.max(0, Number(r.available) - (expired.get(r.productId) ?? 0)),
    }));
  },

  /** Загрузка: склад → машина, под PIN водителя (или подпись на бумаге). */
  async load(db: Db, tenantId: number, actor: Actor, input: { vanId: number; items: Array<{ productId: number; quantity: number }>; pin?: string | null; paperSigned?: boolean; note?: string | null }) {
    const van = await vanOf(db, tenantId, input.vanId);
    const signedAt = await assertDriverSigned(db, tenantId, van.driverId, input);
    const main = await mainWarehouse(db, tenantId);
    const r = await transferStock(db, tenantId, actor, {
      fromWarehouseId: main.id, toWarehouseId: van.id, items: input.items,
      notes: `Загрузка машины «${van.name}»${signedAt ? " · PIN водителя" : " · подпись на бумаге"}${input.note ? ` · ${sanitizeString(input.note)}` : ""}`,
      acceptedBy: van.driverId,
    });
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "van.loaded", targetType: "warehouse", targetId: van.id, targetLabel: van.name, meta: { items: input.items.length, quantity: input.items.reduce((s, i) => s + i.quantity, 0), driverId: van.driverId, signed: signedAt ? "PIN" : "paper" } });
    return { transfers: r.count };
  },

  /** Возврат на склад: машина → склад. Подписи не надо — принимает кладовщик, он и проводит. */
  async unload(db: Db, tenantId: number, actor: Actor, input: { vanId: number; items: Array<{ productId: number; quantity: number }>; note?: string | null }) {
    const van = await vanOf(db, tenantId, input.vanId);
    const main = await mainWarehouse(db, tenantId);
    const r = await transferStock(db, tenantId, actor, {
      fromWarehouseId: van.id, toWarehouseId: main.id, items: input.items,
      notes: `Возврат с машины «${van.name}»${input.note ? ` · ${sanitizeString(input.note)}` : ""}`,
    });
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "van.unloaded", targetType: "warehouse", targetId: van.id, targetLabel: van.name, meta: { items: input.items.length, quantity: input.items.reduce((s, i) => s + i.quantity, 0) } });
    return { transfers: r.count };
  },

  /**
   * Пересчёт машины. Что по системе есть, а в кузове нет — списывается с
   * машины и ложится долгом водителя по цене продажи. Излишек — приходуется
   * на машину (товар нашёлся), долга не рождает. Товар, которого нет в
   * списке пересчёта, считается непосчитанным и не трогается.
   */
  async count(db: Db, tenantId: number, actor: Actor, input: { vanId: number; counted: Array<{ productId: number; quantity: number }>; note?: string | null; now?: Date }) {
    const now = input.now ?? new Date();
    const van = await vanOf(db, tenantId, input.vanId);
    if (!van.driverId) throw badRequest("У машины нет водителя — недостачу не на кого записать");
    const counted = new Map(input.counted.map(c => [c.productId, c.quantity]));
    const lines: Array<{ productId: number; name: string; system: number; counted: number; diff: number; unitPrice: number }> = [];
    let shortage = 0;
    let docId: number | null = null;
    await db.transaction(async (tx) => {
      const rows = await tx.select({ productId: products.id, name: products.name, unitPrice: products.unitPrice, onHand: warehouseStock.currentStock })
        .from(warehouseStock).innerJoin(products, eq(products.id, warehouseStock.productId))
        .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, van.id), inArray(warehouseStock.productId, [...counted.keys()])))
        .for("update");
      const known = new Set(rows.map(r => r.productId));
      for (const id of counted.keys()) if (!known.has(id)) throw badRequest("В пересчёте товар, которого на машине не было");
      for (const r of rows) {
        const system = Number(r.onHand), actual = counted.get(r.productId) ?? system;
        if (actual < 0) throw badRequest("Количество не может быть отрицательным");
        const diff = Math.round((actual - system) * 100) / 100;
        lines.push({ productId: r.productId, name: r.name, system, counted: actual, diff, unitPrice: Number(r.unitPrice) });
        if (diff === 0) continue;
        await applyStockEffect(tx, {
          tenantId, warehouseId: van.id, items: [{ productId: r.productId, quantity: String(Math.abs(diff)) }],
          shift: { onHand: diff < 0 ? -1 : 1, held: 0 }, reason: "inventory",
          notes: `Пересчёт машины «${van.name}»: по системе ${system}, в кузове ${actual}`,
        });
        if (diff < 0) shortage += -diff * Number(r.unitPrice);
      }
      shortage = Math.round(shortage * 100) / 100;
      if (shortage > 0) {
        const short = lines.filter(l => l.diff < 0).map(l => `${l.name} −${-l.diff}`).join(", ");
        docId = await CashService.chargeEmployee(tx, tenantId, actor, {
          userId: van.driverId!, amount: shortage, credit: ACCOUNT.stockShortage(van.id),
          note: `Недостача на машине «${van.name}»: ${short}${input.note ? ` · ${sanitizeString(input.note)}` : ""}`, now,
        });
      }
    });
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "van.counted", targetType: "warehouse", targetId: van.id, targetLabel: van.name, meta: { lines: lines.length, shortage, driverId: van.driverId, docId } });
    return { lines, shortage, docId };
  },

  /**
   * Продажа с колёс: заказ рождается доставленным, товар уходит с машины,
   * деньги — платежом того же вида, что у доставки. Идемпотентно по ключу.
   */
  async sale(db: Db, tenantId: number, actor: Actor, input: {
    vanId: number; shopId: number; items: Array<{ productId: number; quantity: string }>; paymentMethod: "cash" | "card" | "transfer" | "debt";
    paidAmount?: number; notes?: string | null; idempotencyKey?: string | null; discount?: number;
  }) {
    const van = await vanOf(db, tenantId, input.vanId);
    // Продаёт водитель машины; кассир может провести за него, тогда автор платежа — всё равно водитель: деньги у него.
    const seller = van.driverId ?? actor.id;
    if (actor.role !== "ceo" && actor.role !== "operator" && actor.id !== van.driverId) throw badRequest("С этой машины продаёт её водитель");
    const items = mergeDuplicateItems(input.items);
    if (!items.length) throw badRequest("В продаже нет ни одного товара");
    const [shop] = await db.select({ id: shops.id, name: shops.name, debt: shops.debt, creditLimit: shops.creditLimit }).from(shops)
      .where(and(eq(shops.id, input.shopId), eq(shops.tenantId, tenantId))).limit(1);
    if (!shop) throw badRequest("Магазин не найден в вашей организации");
    if (input.idempotencyKey) {
      const [existing] = await db.select({ id: orders.id, orderNumber: orders.orderNumber }).from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) return { id: existing.id, orderNumber: existing.orderNumber, total: 0, paid: 0, idempotent: true as const };
    }
    const discountPct = Number(input.discount ?? 0);
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) throw badRequest("Скидка — процент от 0 до 100");

    const result = await db.transaction(async (tx) => {
      const productRows = await tx.select({ id: products.id, name: products.name, unitPrice: products.unitPrice, costPrice: products.costPrice }).from(products)
        .where(and(inArray(products.id, items.map(i => i.productId)), eq(products.tenantId, tenantId), eq(products.status, "active")));
      const priceMap = new Map(productRows.map(p => [p.id, p.unitPrice]));
      const costMap = new Map(productRows.map(p => [p.id, p.costPrice]));
      const nameMap = new Map(productRows.map(p => [p.id, p.name]));
      for (const it of items) if (!priceMap.has(it.productId)) throw badRequest("В продаже товар, которого нет в каталоге или он выключен");
      const resolved = await resolvePrices(tx, tenantId, input.shopId, items, priceMap);
      for (const [productId, r] of resolved) priceMap.set(productId, r.price);

      let subtotal = 0;
      for (const it of items) subtotal += Number(priceMap.get(it.productId)!) * Number(it.quantity);
      const discount = subtotal * (discountPct / 100);
      const total = Math.round((subtotal - discount) * 100) / 100;
      const paid = Math.min(total, Math.max(0, Math.round(Number(input.paidAmount ?? (input.paymentMethod === "debt" ? 0 : total)) * 100) / 100));
      if (input.paymentMethod !== "debt" && paid <= 0) throw badRequest("Продажа не в долг — укажите, сколько заплатил магазин");
      if (paid < total && shop.creditLimit != null && Number(shop.debt) + (total - paid) > Number(shop.creditLimit)) {
        throw badRequest(`Кредитный лимит магазина «${shop.name}» ${Number(shop.creditLimit).toFixed(0)} превышен: долг ${Number(shop.debt).toFixed(0)} + остаток ${(total - paid).toFixed(0)}`);
      }

      // Остаток машины — под замком; просроченное не продаётся.
      const stockRows = await tx.select({ productId: warehouseStock.productId, available: warehouseStock.available }).from(warehouseStock)
        .where(and(eq(warehouseStock.tenantId, tenantId), eq(warehouseStock.warehouseId, van.id), inArray(warehouseStock.productId, items.map(i => i.productId))))
        .for("update");
      const availableOf = new Map(stockRows.map(r => [r.productId, Number(r.available)]));
      const expired = await expiredByProduct(tx, tenantId, van.id, items.map(i => i.productId));
      for (const it of items) {
        const inVan = availableOf.get(it.productId) ?? 0;
        const sellable = inVan - (expired.get(it.productId) ?? 0);
        const name = nameMap.get(it.productId) ?? "";
        if (sellable < Number(it.quantity)) throw badRequest(`«${name}»: в машине ${inVan}, а в продаже ${it.quantity}`);
      }

      let number = await nextOrderNumber(tx, tenantId);
      let id = 0;
      const now = new Date();
      for (let attempt = 0; ; attempt++) {
        try {
          const [r] = await tx.insert(orders).values({
            tenantId, orderNumber: number, shopId: input.shopId, agentId: seller, courierId: seller,
            status: "delivered", deliveryStatus: "delivered", deliveredAt: now,
            deliveryResult: paid >= total ? "paid" : "partial_paid",
            subtotal: subtotal.toFixed(2), discount: discount.toFixed(2), total: total.toFixed(2),
            notes: input.notes ? sanitizeString(input.notes) : null, idempotencyKey: input.idempotencyKey ?? null,
            paymentMethod: input.paymentMethod, warehouseId: van.id,
          });
          id = Number(r.insertId);
          break;
        } catch (err: unknown) {
          if (!isDuplicateEntry(err) || attempt >= 4 || (input.idempotencyKey && String(err).includes("idempotency"))) throw err;
          number = `№${Number(number.slice(1)) + 1}`;
        }
      }
      await tx.insert(orderItems).values(items.map(it => {
        const unitPrice = Number(priceMap.get(it.productId)!);
        return {
          orderId: id, productId: it.productId, quantity: it.quantity, deliveredQuantity: it.quantity,
          unitPrice: unitPrice.toFixed(2), costPrice: costMap.get(it.productId) ?? "0.00",
          subtotal: (unitPrice * Number(it.quantity)).toFixed(2), priceListId: resolved.get(it.productId)?.priceListId ?? null,
        };
      }));
      // Товар уходит с машины сразу: резерва у продажи с колёс нет.
      await applyStockEffect(tx, {
        tenantId, warehouseId: van.id, items: items.map(i => ({ productId: i.productId, quantity: i.quantity })),
        shift: { onHand: -1, held: 0 }, reason: "order_delivery", referenceId: id, notes: `Продажа с машины «${van.name}» ${number}`,
      });
      if (paid > 0) {
        await tx.insert(payments).values({
          tenantId, shopId: input.shopId, orderId: id, amount: paid.toFixed(2), type: "payment",
          paymentMethod: input.paymentMethod === "debt" ? "cash" : input.paymentMethod,
          status: paid < total ? "partially_paid" : "paid", totalOrderAmount: total.toFixed(2), paidAmount: paid.toFixed(2),
          debtAmount: Math.max(0, total - paid).toFixed(2), paidAt: now, createdBy: seller,
          notes: input.notes ? sanitizeString(input.notes) : null,
        });
      }
      await recalcShopDebt(tx, tenantId, input.shopId);
      return { id, number, total, paid };
    });

    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "van.sale", targetType: "order", targetId: result.id, targetLabel: `${result.number} · ${shop.name}`, meta: { van: van.name, total: result.total, paid: result.paid, method: input.paymentMethod, sellerId: seller } });
    return { id: result.id, orderNumber: result.number, total: result.total, paid: result.paid, idempotent: false as const };
  },

  /** Заказы с машин за срок — для списка и сверки. */
  async sales(db: Db, tenantId: number, input: { vanId?: number; from: Date; to: Date }) {
    return db.select({ id: orders.id, orderNumber: orders.orderNumber, shopName: shops.name, total: orders.total, paymentMethod: orders.paymentMethod, deliveredAt: orders.deliveredAt, vanName: warehouses.name })
      .from(orders).innerJoin(shops, eq(shops.id, orders.shopId)).innerJoin(warehouses, eq(warehouses.id, orders.warehouseId))
      .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), ...(input.vanId ? [eq(orders.warehouseId, input.vanId)] : []),
        sql`${orders.deliveredAt} >= ${input.from}`, sql`${orders.deliveredAt} < ${input.to}`))
      .orderBy(desc(orders.id)).limit(500);
  },
};
