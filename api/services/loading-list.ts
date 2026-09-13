import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  orders, orderItems, products, shops, users, territories, warehouses,
  loadingLists, loadingListOrders, loadingListItems,
} from "@db/schema";
import { rowsOf } from "../lib/db-rows";
import {
  OPEN_ORDER_STATUSES, ORDER_STATUS_LABELS, LOADING_LIST_STATUS_LABELS, holdsStock,
} from "../lib/order-status";
import { badRequest } from "../lib/errors";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/*
  Два разных прочтения таблицы сотрудников в одном запросе.

  Заказ знает своего агента, лист — своего курьера, и оба лежат в users.
  Без псевдонимов соединение по одной и той же таблице дважды даёт «Not unique
  table/alias», а с одним — молча подставляет имя агента вместо курьера.
*/
const couriers = alias(users, "couriers");
const courierUser = alias(users, "courier_user");

/* ═══════════════════════════════════════════════════════════════════════════
   СБОРКА КАК ПРОЦЕСС

   Лист был бумагой: SUM по товару, печать и четыре статуса, которые никто не
   подтверждал. Кладовщик собирал по бумаге; недостача всплывала у магазина
   как «частичная доставка», а какую партию брать, он решал сам — хотя при
   отгрузке за него уже решает FEFO, и на бумаге этого не было.

   Теперь у листа есть строки (loading_list_items): сколько нужно, сколько
   собрано, какие партии брать — по тому же порядку, что и списание (раньше
   сгорает — раньше уходит, просроченное не берём). «Готов» лист становится
   только через подтверждение сборки по строкам; собрано меньше — недостача
   записана на складе и ушла офису, а не выяснилась у прилавка.

   Заказы при этом не трогаются: сколько довезли, по-прежнему решает курьер
   у магазина, и деньги идут за довезённым. Партии здесь — подсказка, а не
   списание: списывает отгрузка, тем же порядком.
   ═══════════════════════════════════════════════════════════════════════════ */

export type PlannedBatch = { batch: string | null; expires: string | null; qty: number };

/** Какие партии брать под нужное количество — FEFO, как в stock-ledger.consumeBatches, но без блокировки и списания. */
async function planBatches(db: Db, tenantId: number, warehouseId: number, need: Map<number, number>): Promise<Map<number, PlannedBatch[]>> {
  const out = new Map<number, PlannedBatch[]>();
  const ids = [...need.keys()];
  if (ids.length === 0) return out;
  const rows = rowsOf<{ product_id: number | string; batch_number: string | null; expires_at: string | null; quantity: string }>(await db.execute(sql`
    SELECT product_id, batch_number, DATE_FORMAT(expires_at, '%Y-%m-%d') AS expires_at, quantity FROM stock_batches
    WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}
      AND product_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      AND quantity > 0 AND (expires_at IS NULL OR expires_at >= CURDATE())
    ORDER BY product_id, expires_at IS NULL, expires_at, received_at, id
  `));
  const left = new Map(need);
  for (const r of rows) {
    const pid = Number(r.product_id);
    const rest = left.get(pid) ?? 0;
    if (rest <= 0) continue;
    const take = Math.min(Number(r.quantity), rest);
    out.set(pid, [...(out.get(pid) ?? []), { batch: r.batch_number ?? null, expires: r.expires_at ?? null, qty: take }]);
    left.set(pid, rest - take);
  }
  return out;
}

/**
 * Сверить собранное с нужным. Чистая функция — ради проверки без базы.
 *
 * Не названный товар считается собранным полностью: экран шлёт все строки, а
 * молчание про строку — это «как в листе», не «ноль». Больше заказанного не
 * грузят: лишнее на машине — это товар, который никому не выписан.
 */
export function applyPicks(
  lines: Array<{ productId: number; name: string; required: number }>,
  picks: Array<{ productId: number; pickedQty: string | number }>,
): { picked: Map<number, number>; shortages: Array<{ productId: number; name: string; required: number; picked: number }> } {
  const byId = new Map(picks.map(p => [p.productId, Number(p.pickedQty)]));
  const unknown = [...byId.keys()].filter(id => !lines.some(l => l.productId === id));
  if (unknown.length > 0) throw badRequest(`В листе нет товаров с id ${unknown.join(", ")} — обновите список и повторите.`);
  const picked = new Map<number, number>();
  const shortages: Array<{ productId: number; name: string; required: number; picked: number }> = [];
  for (const l of lines) {
    const qty = byId.has(l.productId) ? byId.get(l.productId)! : l.required;
    if (!Number.isFinite(qty) || qty < 0) throw badRequest(`${l.name}: собранное количество — число не меньше нуля.`);
    if (qty > l.required + 1e-9) throw badRequest(`${l.name}: собрано ${qty}, а в заказах ${l.required} — больше заказанного не грузят.`);
    picked.set(l.productId, qty);
    if (qty < l.required - 1e-9) shortages.push({ productId: l.productId, name: l.name, required: l.required, picked: qty });
  }
  return { picked, shortages };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ПОГРУЗОЧНЫЕ ЛИСТЫ

   ── Почему отдельным модулем ────────────────────────────────────────────────

   Жили внутри services/order.ts, в файле на три тысячи строк. Общего у них с
   заказом ровно одно — ссылка: лист СОБИРАЕТ заказы, но не трогает ни остаток,
   ни долг магазина, ни статус заказа. Из внутренностей заказа блоку нужен был
   один помощник — badRequest, — и тот оказался не про заказы, а про то, как
   tRPC отличает разговор с человеком от сбоя (см. api/lib/errors.ts).

   Три тысячи строк — это не эстетика. Именно в таких файлах и живёт болезнь,
   которую здесь ловили уже трижды: «написано, выставлено наружу и не
   вызывается ниоткуда». С листами она встала боком живому складу — одиннадцать
   заказов заперлись в незакрытом листе, а ручки, которыми его закрывают, были
   написаны и не позваны (см. loading-list-has-a-way-out.test.ts).

   ── Что лист держит ─────────────────────────────────────────────────────────

   Незакрытый лист ДЕРЖИТ свои заказы: собрать их во второй лист нельзя, иначе
   склад соберёт их дважды. Поэтому у листа обязан быть выход — закрытие и
   удаление, — и оба здесь.
   ═══════════════════════════════════════════════════════════════════════════ */
export const LoadingListService = {

  async createLoadingList(
    db: Db, tenantId: number, createdBy: number,
    input: {
      orderIds: number[];
      format: "aggregated" | "byRoute";
      warehouseId?: number;
      options?: { includeBarcodes?: boolean; includeWeight?: boolean; includeTotalWeight?: boolean };
    },
  ) {
    if (input.orderIds.length === 0) throw new Error("Выберите хотя бы один заказ");

    const ordersData = await db.select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      shopId: orders.shopId, agentId: orders.agentId, total: orders.total,
      paymentMethod: orders.paymentMethod,
      shopName: shops.name, shopAddress: shops.address, shopCity: shops.city,
      shopPhone: shops.phone, shopGpsLat: shops.gpsLat, shopGpsLng: shops.gpsLng,
      shopDebt: shops.debt, agentName: users.name,
      territoryName: territories.name,
      courierName: couriers.name,
    }).from(orders)
      .leftJoin(shops, and(eq(orders.shopId, shops.id), eq(shops.tenantId, tenantId)))
      .leftJoin(users, and(eq(orders.agentId, users.id), eq(users.tenantId, tenantId)))
      .leftJoin(territories, eq(shops.territoryId, territories.id))
      .leftJoin(couriers, and(eq(orders.courierId, couriers.id), eq(couriers.tenantId, tenantId)))
      // Удалённые заказы фильтра не имели вовсе. Удаление — штатный способ
      // исправить ошибку ввода: заказ пропадает из списка и из долга магазина,
      // а в погрузочный лист попадал по-прежнему, и склад собирал товар,
      // которого никто не ждёт.
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, input.orderIds), isNull(orders.deletedAt)));

    if (ordersData.length === 0) throw new Error("Заказы не найдены");

    /*
      ── Один заказ не собирают дважды ──────────────────────────────────────────

      Проверок здесь не было ни одной: список идентификаторов принимался как
      есть. Отсюда три беды, и все три видны только на складе.

      1. Удалённый заказ попадал в лист (фильтр выше).

      2. Закрытый заказ попадал в лист. Товар по нему уже уехал, отменён или
         вернулся — собирать нечего, а кладовщик собирал.

      3. Заказ попадал во ВТОРОЙ лист, оставаясь в первом. Так выходит после
         возврата заказа из архива в работу: первый лист ещё не закрыт, заказ
         в нём есть, и новый лист велит собрать то же самое ещё раз. Товар со
         склада уходит дважды, а расхождение всплывает при пересчёте остатков
         недели через две.

      Отказ, а не тихий пропуск: оператор выбрал эти заказы осознанно, и
      молча собрать не все — значит отправить машину с недогрузом, ничего об
      этом не сказав.
    */
    const found = new Map(ordersData.map(o => [o.id, o]));
    const missing = input.orderIds.filter(id => !found.has(id));
    if (missing.length > 0) {
      throw badRequest(
        `Не найдены или удалены заказы: ${missing.join(", ")}. Обновите список и выберите заново.`,
      );
    }

    const closed = ordersData.filter(o => !holdsStock(o.status));
    if (closed.length > 0) {
      const names = closed.map(o => `${o.orderNumber} (${ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ?? o.status})`);
      throw badRequest(
        `Эти заказы уже закрыты, собирать по ним нечего: ${names.join(", ")}. ` +
        `Уберите их из выбора или верните в работу.`,
      );
    }

    /*
      Незакрытый лист — это ещё не отгруженный лист: preparing, ready, loading,
      loaded. Доставленный в счёт не идёт: по нему товар уже уехал, и второй
      круг заказа собирают заново на законных основаниях.
    */
    const alreadyListed = await db.select({
      orderId: loadingListOrders.orderId,
      listNumber: loadingLists.listNumber,
      status: loadingLists.status,
    }).from(loadingListOrders)
      .innerJoin(loadingLists, eq(loadingListOrders.listId, loadingLists.id))
      .where(and(
        eq(loadingLists.tenantId, tenantId),
        inArray(loadingListOrders.orderId, input.orderIds),
      ));

    const stillOpen = alreadyListed.filter(r => r.status !== "delivered");
    if (stillOpen.length > 0) {
      /*
        Список листов, а не список заказов.

        Прежнее сообщение перечисляло КАЖДЫЙ заказ со своим листом: при
        одиннадцати заказах из одного листа выходило одиннадцать раз повторённое
        «— лист ZL-20260908-JPXE», и главное — какой лист мешает — тонуло в
        повторе. Мешает лист, а не заказы, и назвать надо его.

        И сказать, ГДЕ его закрыть. Раньше сообщение советовало «закройте
        прежний лист», а экрана листов не существовало вовсе: ручки были
        написаны и не вызывались ниоткуда. Совет вёл в никуда.
      */
      const byList = new Map<string, number>();
      for (const r of stillOpen) byList.set(r.listNumber, (byList.get(r.listNumber) ?? 0) + 1);
      const lists = [...byList.entries()]
        .map(([number, count]) => `${number} (${count} зак.)`)
        .join(", ");

      throw badRequest(
        `Эти заказы уже стоят в незакрытом погрузочном листе: ${lists}. ` +
        `Склад собрал бы их дважды. Откройте «Погрузочные листы» на этой странице ` +
        `и закройте или удалите прежний лист — либо уберите заказы из выбора.`,
      );
    }

    // Fetch items aggregated
    const items = await db.select({
      productId: orderItems.productId,
      productName: products.name,
      productCode: products.code,
      barcode: products.barcode,
      unit: products.unit,
      unitWeight: products.unitWeight,
      packSize: products.packSize,
      packLabel: products.packLabel,
      totalQty: sql<string>`SUM(${orderItems.quantity})`,
      totalPrice: sql<string>`SUM(${orderItems.subtotal})`,
    }).from(orderItems)
      .innerJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId)))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orderItems.orderId, input.orderIds)))
      .groupBy(orderItems.productId, products.name, products.code, products.barcode, products.unit, products.unitWeight, products.packSize, products.packLabel);

    // Fetch items grouped by (product, agent) for the route/agent-matrix format
    const itemsByAgent = await db.select({
      productId: orderItems.productId,
      productName: products.name,
      productCode: products.code,
      unit: products.unit,
      agentId: orders.agentId,
      agentName: users.name,
      totalQty: sql<string>`SUM(${orderItems.quantity})`,
    }).from(orderItems)
      .innerJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId)))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(users, and(eq(orders.agentId, users.id), eq(users.tenantId, tenantId)))
      .where(and(eq(orders.tenantId, tenantId), inArray(orderItems.orderId, input.orderIds)))
      .groupBy(orderItems.productId, products.name, products.code, products.unit, orders.agentId, users.name);

    const totalItems = items.reduce((s, i) => s + Number(i.totalQty), 0);
    const totalWeight = items.reduce((s, i) => s + Number(i.totalQty) * Number(i.unitWeight ?? 0), 0);

    // Склад листа: указанный, иначе основной — продают только с него.
    let warehouseId = input.warehouseId ?? null;
    if (!warehouseId) {
      const [w] = await db.select({ id: warehouses.id }).from(warehouses)
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
      warehouseId = w?.id ?? null;
    }
    const need = new Map(items.map(i => [Number(i.productId), Number(i.totalQty)]));
    const planned = warehouseId ? await planBatches(db, tenantId, warehouseId, need) : new Map<number, PlannedBatch[]>();

    // Generate list number
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const listNumber = `ZL-${date}-${rand}`;

    // Insert loading list
    const [result] = await db.insert(loadingLists).values({
      tenantId, listNumber,
      warehouseId,
      agentId: ordersData[0]?.agentId ?? null,
      status: "preparing",
      totalOrders: ordersData.length,
      totalItems,
      totalWeight: totalWeight.toFixed(3),
      createdBy,
    });
    const listId = Number(result.insertId);

    // Link orders to list
    await db.insert(loadingListOrders).values(
      input.orderIds.map(orderId => ({ listId, orderId }))
    );
    // Строки сборки: нужно, собрано (пока нет), партии-подсказка.
    if (items.length > 0) {
      await db.insert(loadingListItems).values(items.map(i => ({
        listId, productId: Number(i.productId), requiredQty: String(i.totalQty),
        batches: planned.get(Number(i.productId)) ?? null,
      })));
    }

    // Audit
    try {
      const { recordAudit } = await import("./audit-log");
      await recordAudit(db, {
        tenantId, actorId: createdBy, action: "loading_list.created",
        targetType: "loading_list", targetId: listId,
        meta: { listNumber, orderIds: input.orderIds, totalWeight, format: input.format },
      });
    } catch { /* non-blocking */ }

    return {
      listId, listNumber, orders: ordersData,
      items: items.map(i => ({ ...i, batches: planned.get(Number(i.productId)) ?? [] })),
      itemsByAgent, totalOrders: ordersData.length, totalItems, totalWeight,
    };
  },

  async listLoadingLists(db: Db, tenantId: number, opts?: { page?: number; pageSize?: number; status?: string }) {
    const page = opts?.page ?? 1;
    const limit = opts?.pageSize ?? 25;
    const offset = (page - 1) * limit;

    const conditions = [eq(loadingLists.tenantId, tenantId)];
    if (opts?.status) conditions.push(eq(loadingLists.status, opts.status as "preparing" | "ready" | "loading" | "loaded" | "delivered"));

    const [data, countResult] = await Promise.all([
      db.select({
        id: loadingLists.id,
        listNumber: loadingLists.listNumber,
        status: loadingLists.status,
        totalOrders: loadingLists.totalOrders,
        totalItems: loadingLists.totalItems,
        totalWeight: loadingLists.totalWeight,
        createdAt: loadingLists.createdAt,
        loadedAt: loadingLists.loadedAt,
        agentName: users.name,
        courierId: loadingLists.courierId,
        // Имя курьера — вторым соединением с той же таблицей: агент и курьер у
        // листа разные люди, и одно соединение не даёт обоих.
        courierName: courierUser.name,
        // Строки, где собрано меньше нужного, — чтобы недостача была видна в списке, а не в карточке.
        shortLines: sql<number>`(SELECT COUNT(*) FROM loading_list_items i WHERE i.list_id = ${loadingLists.id} AND i.picked_qty IS NOT NULL AND i.picked_qty < i.required_qty)`,
      }).from(loadingLists)
        .leftJoin(users, and(eq(loadingLists.agentId, users.id), eq(users.tenantId, tenantId)))
        .leftJoin(courierUser, and(eq(loadingLists.courierId, courierUser.id), eq(courierUser.tenantId, tenantId)))
        .where(and(...conditions))
        .orderBy(desc(loadingLists.createdAt))
        .limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(loadingLists).where(and(...conditions)),
    ]);

    return { data, total: Number(countResult[0]?.count ?? 0), page, pageSize: limit };
  },

  /**
   * Отдать рейс курьеру.
   *
   * Одним действием: и лист, и все его заказы. Раньше курьера назначали на
   * каждый заказ отдельно — двадцать одинаковых выборов на один рейс, — и
   * половина заказов оставалась без курьера, потому что на середине списка
   * человек сбивался.
   *
   * Заказы обновляются ТОЛЬКО открытые: доставленный из этого же листа уже
   * доехал, и переписывать ему курьера значило бы задним числом менять то, по
   * чему уже посчитана зарплата.
   */
  async assignCourierToList(db: Db, tenantId: number, listId: number, courierId: number) {
    const [list] = await db.select({ id: loadingLists.id, listNumber: loadingLists.listNumber })
      .from(loadingLists)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)))
      .limit(1);
    if (!list) throw new Error("Погрузочный лист не найден");

    const [courier] = await db.select({ id: users.id, name: users.name }).from(users)
      .where(and(
        eq(users.id, courierId),
        eq(users.tenantId, tenantId),
        eq(users.role, "courier"),
        eq(users.status, "active"),
      )).limit(1);
    if (!courier) throw new Error("Курьер не найден в вашей организации");

    const rows = await db.select({ orderId: loadingListOrders.orderId })
      .from(loadingListOrders)
      .where(eq(loadingListOrders.listId, listId));
    const orderIds = rows.map(r => Number(r.orderId));

    await db.update(loadingLists).set({ courierId })
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)));

    let assigned = 0;
    if (orderIds.length > 0) {
      const [result] = await db.update(orders)
        .set({ courierId, deliveryStatus: "assigned" })
        .where(and(
          eq(orders.tenantId, tenantId),
          inArray(orders.id, orderIds),
          inArray(orders.status, OPEN_ORDER_STATUSES),
          isNull(orders.deletedAt),
        ));
      assigned = Number((result as { affectedRows?: number }).affectedRows ?? 0);
    }

    return { listNumber: list.listNumber, courierName: courier.name ?? "", assigned, total: orderIds.length };
  },

  async updateLoadingListStatus(db: Db, tenantId: number, listId: number, newStatus: string) {
    const validTransitions: Record<string, string[]> = {
      preparing: ["ready"],
      ready: ["loading"],
      loading: ["loaded"],
      loaded: ["delivered"],
    };

    const [list] = await db.select({ id: loadingLists.id, status: loadingLists.status })
      .from(loadingLists)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)))
      .limit(1);
    if (!list) throw new Error("Загрузочный лист не найден");

    if (!validTransitions[list.status]?.includes(newStatus)) {
      throw new Error(`Невозможно перевести из «${LOADING_LIST_STATUS_LABELS[list.status]}» в «${LOADING_LIST_STATUS_LABELS[newStatus as keyof typeof LOADING_LIST_STATUS_LABELS] ?? newStatus}»`);
    }
    if (list.status === "preparing" && newStatus === "ready") {
      // Лист со строками становится готовым только через сборку: кнопка
      // статуса — для листов, собранных до появления строк.
      const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(loadingListItems).where(eq(loadingListItems.listId, listId));
      if (Number(n) > 0) throw badRequest("Этот лист собирают по строкам: нажмите «Собрать» и подтвердите количество.");
    }

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "loaded") updates.loadedAt = new Date();
    if (newStatus === "delivered") updates.deliveredAt = new Date();

    await db.update(loadingLists).set(updates)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)));

    return { success: true };
  },

  /**
   * Удалить погрузочный лист, собранный по ошибке.
   *
   * ── Зачем ─────────────────────────────────────────────────────────────────
   *
   * Пока лист не отгружен, он держит свои заказы: собрать их во второй лист
   * нельзя, иначе склад соберёт их дважды. Выйти из этого можно было только
   * доведя лист до «доставлен» — через четыре последовательных перевода, и
   * каждый из них означал бы, что товар поехал, хотя он никуда не ехал.
   *
   * У арендатора это кончилось тем, что одиннадцать заказов оказались заперты
   * в листе ZL-20260908-JPXE навсегда: система писала «закройте прежний лист»,
   * а закрыть его было нечем — ни экрана, ни удаления.
   *
   * Удаление честнее перевода в «доставлен»: доставки не было, и записывать
   * её ради разблокировки значит портить историю ради обхода.
   *
   * ── Что нельзя удалить ────────────────────────────────────────────────────
   *
   * Отгруженный лист. Он больше не держит заказы (см. проверку в
   * createLoadingList), а как запись о факте — нужен.
   */
  async deleteLoadingList(db: Db, tenantId: number, listId: number) {
    const [list] = await db.select({ id: loadingLists.id, status: loadingLists.status, listNumber: loadingLists.listNumber })
      .from(loadingLists)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)))
      .limit(1);
    if (!list) throw new TRPCError({ code: "NOT_FOUND", message: "Погрузочный лист не найден" });

    if (list.status === "delivered") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Лист ${list.listNumber} уже отгружен — он ничего не держит и остаётся записью о факте.`,
      });
    }

    // Связки заказов сначала: без этого строки остались бы сиротами и
    // продолжили бы держать заказы уже несуществующим листом.
    await db.delete(loadingListOrders).where(eq(loadingListOrders.listId, listId));
    await db.delete(loadingLists).where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)));
    return { success: true, listNumber: list.listNumber };
  },

  /** Строки листа для экрана сборки: нужно, собрано, партии. */
  async pickingLines(db: Db, tenantId: number, listId: number) {
    const [list] = await db.select({ id: loadingLists.id, status: loadingLists.status, listNumber: loadingLists.listNumber })
      .from(loadingLists)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)))
      .limit(1);
    if (!list) throw new TRPCError({ code: "NOT_FOUND", message: "Погрузочный лист не найден" });
    const lines = await db.select({
      productId: loadingListItems.productId,
      productName: products.name, productCode: products.code, unit: products.unit,
      packSize: products.packSize, packLabel: products.packLabel,
      requiredQty: loadingListItems.requiredQty, pickedQty: loadingListItems.pickedQty,
      batches: loadingListItems.batches,
    }).from(loadingListItems)
      .innerJoin(products, eq(loadingListItems.productId, products.id))
      .where(eq(loadingListItems.listId, listId))
      .orderBy(products.name);
    return { listNumber: list.listNumber, status: list.status, lines };
  },

  /**
   * Подтвердить сборку: записать собранное по строкам, лист — «готов».
   *
   * Недостача (собрано меньше нужного) остаётся в строках и уходит офису
   * уведомлением. Заказы не меняются: сколько довезли, решит курьер у
   * магазина, и деньги идут за довезённым — так же, как и до сборки по строкам.
   */
  async confirmPicking(
    db: Db, tenantId: number, userId: number, listId: number,
    picks: Array<{ productId: number; pickedQty: string }>,
  ) {
    const [list] = await db.select({ id: loadingLists.id, status: loadingLists.status, listNumber: loadingLists.listNumber })
      .from(loadingLists)
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)))
      .limit(1);
    if (!list) throw new TRPCError({ code: "NOT_FOUND", message: "Погрузочный лист не найден" });
    if (list.status !== "preparing") {
      throw badRequest(`Лист ${list.listNumber} уже «${LOADING_LIST_STATUS_LABELS[list.status]}» — сборка подтверждается один раз.`);
    }
    const rows = await db.select({ productId: loadingListItems.productId, name: products.name, requiredQty: loadingListItems.requiredQty })
      .from(loadingListItems)
      .innerJoin(products, eq(loadingListItems.productId, products.id))
      .where(eq(loadingListItems.listId, listId));
    if (rows.length === 0) {
      throw badRequest("У этого листа нет строк — он собран до появления сборки по строкам; переведите его кнопкой статуса.");
    }
    const { picked, shortages } = applyPicks(
      rows.map(r => ({ productId: Number(r.productId), name: r.name, required: Number(r.requiredQty) })),
      picks,
    );
    for (const [productId, qty] of picked) {
      await db.update(loadingListItems).set({ pickedQty: qty.toFixed(2) })
        .where(and(eq(loadingListItems.listId, listId), eq(loadingListItems.productId, productId)));
    }
    await db.update(loadingLists).set({ status: "ready" })
      .where(and(eq(loadingLists.id, listId), eq(loadingLists.tenantId, tenantId)));

    try {
      const { recordAudit } = await import("./audit-log");
      await recordAudit(db, {
        tenantId, actorId: userId, action: "loading_list.picked",
        targetType: "loading_list", targetId: listId,
        meta: { listNumber: list.listNumber, lines: rows.length, shortages },
      });
    } catch { /* non-blocking */ }

    if (shortages.length > 0) {
      const office = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, tenantId), inArray(users.role, ["ceo", "operator"]), eq(users.status, "active")));
      const { NotificationService } = await import("./NotificationService");
      await NotificationService.createBulk(db, {
        tenantId, userIds: office.map(u => u.id), type: "stock",
        title: `Недостача при сборке ${list.listNumber}`,
        message: shortages.map(s => `${s.name}: нужно ${s.required}, собрано ${s.picked}`).join("; ").slice(0, 500),
        link: "/orders",
      });
    }
    return { listNumber: list.listNumber, shortages };
  },
};
