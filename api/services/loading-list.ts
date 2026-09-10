import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  orders, orderItems, products, shops, users, territories,
  loadingLists, loadingListOrders,
} from "@db/schema";
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
      unit: products.unit,
      unitWeight: products.unitWeight,
      totalQty: sql<string>`SUM(${orderItems.quantity})`,
      totalPrice: sql<string>`SUM(${orderItems.subtotal})`,
    }).from(orderItems)
      .innerJoin(products, and(eq(orderItems.productId, products.id), eq(products.tenantId, tenantId)))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(eq(orders.tenantId, tenantId), inArray(orderItems.orderId, input.orderIds)))
      .groupBy(orderItems.productId, products.name, products.code, products.unit, products.unitWeight);

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

    // Generate list number
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const listNumber = `ZL-${date}-${rand}`;

    // Insert loading list
    const [result] = await db.insert(loadingLists).values({
      tenantId, listNumber,
      warehouseId: input.warehouseId ?? null,
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
      listId, listNumber, orders: ordersData, items, itemsByAgent,
      totalOrders: ordersData.length, totalItems, totalWeight,
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
};
