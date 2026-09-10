import { eq, sql } from "drizzle-orm";
import {
  tenants, users, warehouses, territories, shops, products,
  orders, orderItems,
} from "@db/schema";
import { TRPCError } from "@trpc/server";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Песочница для интеграторов.

   ── Зачем она вообще ────────────────────────────────────────────────────────

   ТЗ BEKDRINKS требует её прямым текстом дважды: пункт 13 — «первые испытания
   в отдельной среде, проверять права правкой боевых данных нельзя», и пункт
   16-6 — «среда для испытаний или тестовые данные». Приёмка (17-F) проверяет
   там же, что запись отвергается и что чужая организация недоступна.

   Без неё чужая сторона проверяет выгрузку НА БОЕВЫХ данных настоящего
   арендатора: сначала листает три страницы его заказов, потом нарочно бьётся
   в 401, 403 и 429 его ключом, и всё это — с его суммами и телефонами
   магазинов на экране у третьей компании.

   ── Чего эта функция не может сделать по построению ─────────────────────────

   Испортить живого арендатора. Она отказывается работать, если организация не
   помечена песочницей ИЛИ в ней уже есть хоть один заказ. Второе условие
   важнее первого: пометку можно поставить по ошибке, а заказы в живой
   организации есть всегда.

   Именно поэтому здесь нет ни одного DELETE и ни одного UPDATE чужих строк:
   заполняется только пустое. Соседний db/seed.ts для этого не годится
   принципиально — он ОЧИЩАЕТ базу целиком.

   ── Почему данные выдуманы, а не скопированы ────────────────────────────────

   Скопировать настоящего арендатора было бы проще всего и было бы утечкой:
   названия магазинов, телефоны владельцев и их долги уехали бы третьей
   стороне под видом тестовых. Здесь всё сгенерировано.

   ── Почему одинаково при каждом создании ────────────────────────────────────

   Числа берутся из простого генератора с постоянным зерном, а не из
   Math.random. Пересоздали песочницу — те же суммы и те же статусы, значит
   ожидаемые числа на той стороне не протухают, и наши собственные проверки
   могут сверять точные итоги.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Заказов в песочнице.
 *
 * Приёмка (17-B) требует «не меньше трёх страниц»: страница по умолчанию сто
 * строк, потолок двести. Триста двадцать — это больше трёх страниц и на
 * потолке, и на умолчании, то есть проверка честная при любом их выборе.
 */
export const SANDBOX_ORDER_COUNT = 320;

/** Постоянное зерно: та же песочница при каждом создании. */
const SEED = 20260910;

/** Линейный конгруэнтный генератор — ровно чтобы числа были воспроизводимы. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return {
    /** [0, 1) */
    next(): number {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    },
    /** Целое из [min, max] включительно. */
    int(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    /** Элемент списка. */
    pick<T>(list: readonly T[]): T {
      return list[this.int(0, list.length - 1)];
    },
  };
}

const TERRITORY_NAMES = ["Чиланзар", "Юнусабад", "Мирзо-Улугбек", "Сергели"] as const;

const SHOP_WORDS = [
  "Нодира", "Барака", "Зафар", "Мехригиё", "Олтин", "Дилшод", "Сарбон", "Хумо",
  "Навруз", "Гулистон", "Фаровон", "Ширин", "Азиз", "Каттакурган", "Бахор",
  "Истиклол", "Мираброр", "Шодлик", "Зумрад", "Лочин", "Самарканд", "Сохибкор",
  "Тонг", "Юлдуз", "Яккасарой",
] as const;
const SHOP_KINDS = ["MCHJ", "савдо", "маркет", "дукон"] as const;

const PRODUCT_LINES = [
  { name: "Вода питьевая 0.5", price: 4500, unit: "pcs" },
  { name: "Вода питьевая 1.5", price: 7200, unit: "pcs" },
  { name: "Вода газированная 1.0", price: 6800, unit: "pcs" },
  { name: "Лимонад 1.0", price: 11500, unit: "pcs" },
  { name: "Лимонад 0.5", price: 7900, unit: "pcs" },
  { name: "Сок яблочный 1.0", price: 19800, unit: "pcs" },
  { name: "Сок мультифрукт 1.0", price: 20400, unit: "pcs" },
  { name: "Сок томатный 1.0", price: 18600, unit: "pcs" },
  { name: "Чай холодный 0.5", price: 9300, unit: "pcs" },
  { name: "Энергетик 0.45", price: 14700, unit: "pcs" },
  { name: "Квас 1.5", price: 12900, unit: "pcs" },
  { name: "Минеральная вода 0.5", price: 5600, unit: "pcs" },
] as const;

const AGENT_NAMES = ["Отабек Ражабов", "Санжар Тошев", "Дилноза Каримова", "Азиз Юсупов"] as const;
const COURIER_NAMES = ["Сурож Эркинов", "Бахтиёр Нурматов"] as const;

/**
 * Как часто встречается каждый статус.
 *
 * Доля близка к живой: подавляющее большинство заказов доставлено, немного
 * висит в работе, отмены и возвраты единичны. Ровные доли дали бы получателю
 * ложное представление о том, что он увидит у настоящего арендатора.
 */
const STATUS_MIX: ReadonlyArray<{ status: string; weight: number }> = [
  { status: "delivered", weight: 74 },
  { status: "new", weight: 7 },
  { status: "processing", weight: 6 },
  { status: "shipped", weight: 5 },
  { status: "pending", weight: 3 },
  { status: "cancelled", weight: 3 },
  { status: "returned", weight: 2 },
];

function pickStatus(r: ReturnType<typeof makeRandom>): string {
  const total = STATUS_MIX.reduce((s, x) => s + x.weight, 0);
  let n = r.int(1, total);
  for (const x of STATUS_MIX) {
    n -= x.weight;
    if (n <= 0) return x.status;
  }
  return "delivered";
}

const money = (n: number) => n.toFixed(2);

export interface SandboxContents {
  orders: number;
  shops: number;
  products: number;
  /** Заказы, помеченные удалёнными: их видно только в режиме изменений. */
  deletedOrders: number;
  /** Заказы с обещанным сроком. У остальных он пуст — и это законно (17-G). */
  withPromise: number;
}

/**
 * Заполнить пустую песочницу.
 *
 * Отказывается работать где угодно, кроме пустой организации с пометкой
 * песочницы, — см. разбор в начале файла.
 *
 * `now` параметром: заказы раскладываются назад от этого мгновения, и без
 * него проверка не могла бы сверять даты.
 */
export async function seedSandbox(db: Db, tenantId: number, now: Date = new Date()): Promise<SandboxContents> {
  const [tenant] = await db.select({ isSandbox: tenants.isSandbox })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Организация не найдена" });
  if (!tenant.isSandbox) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Это не песочница. Заполнять выдуманными данными можно только песочницу.",
    });
  }

  const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` })
    .from(orders).where(eq(orders.tenantId, tenantId));
  if (Number(n) > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "В этой организации уже есть заказы — заполнять её нечем и незачем.",
    });
  }

  const r = makeRandom(SEED);

  // ── Склад ────────────────────────────────────────────────────────────────
  // Ровно один и основной: продают в этом продукте только с основного склада
  // (решение владельца), и второй склад в песочнице показывал бы выгрузке то,
  // чего в жизни не бывает.
  const [wh] = await db.insert(warehouses).values({
    tenantId, name: "Основной склад", city: "Ташкент", isDefault: true, status: "active",
  });
  const warehouseId = Number(wh.insertId);

  // ── Территории ───────────────────────────────────────────────────────────
  const territoryIds: number[] = [];
  for (const name of TERRITORY_NAMES) {
    const [t] = await db.insert(territories).values({ tenantId, name });
    territoryIds.push(Number(t.insertId));
  }

  // ── Сотрудники ───────────────────────────────────────────────────────────
  /*
    Пароль у них заведомо непригодный: строка, которой не соответствует ни
    один пароль, потому что это не хеш. Войти этими учётными записями нельзя
    ни при каком вводе — они нужны только как имена в выгрузке. Входит
    интегратор отдельной учётной записью, которую выдаёт createSandbox.
  */
  const UNUSABLE = "!" as const;
  const agentIds: number[] = [];
  for (const [i, name] of AGENT_NAMES.entries()) {
    const [u] = await db.insert(users).values({
      tenantId, name, email: `agent${i + 1}@sandbox.invalid`,
      passwordHash: UNUSABLE, role: "agent", status: "active", lastSignInAt: now,
    });
    agentIds.push(Number(u.insertId));
  }
  const courierIds: number[] = [];
  for (const [i, name] of COURIER_NAMES.entries()) {
    const [u] = await db.insert(users).values({
      tenantId, name, email: `courier${i + 1}@sandbox.invalid`,
      passwordHash: UNUSABLE, role: "courier", status: "active", lastSignInAt: now,
    });
    courierIds.push(Number(u.insertId));
  }

  // ── Товары ───────────────────────────────────────────────────────────────
  const productRows: Array<{ id: number; price: number }> = [];
  for (const [i, line] of PRODUCT_LINES.entries()) {
    const [p] = await db.insert(products).values({
      tenantId, code: `SB-${String(i + 1).padStart(3, "0")}`, name: line.name,
      unit: line.unit, unitPrice: money(line.price), status: "active",
    });
    productRows.push({ id: Number(p.insertId), price: line.price });
  }

  // ── Магазины ─────────────────────────────────────────────────────────────
  const shopIds: number[] = [];
  for (const [i, word] of SHOP_WORDS.entries()) {
    /*
      Один магазин намеренно оставлен без территории. Выгрузка обязана отдать
      по нему territory_id: null, и получатель обязан это пережить: правило
      «отсутствующее не подменяется догадкой» проверяется на живом примере, а
      не на словах в документации.
    */
    const territoryId = i === 0 ? null : r.pick(territoryIds);
    const [s] = await db.insert(shops).values({
      tenantId,
      name: `${word} ${r.pick(SHOP_KINDS)}`,
      ownerName: `Владелец ${word}`,
      phone: `+9989${String(10_000_000 + r.int(0, 89_999_999)).slice(0, 8)}`,
      city: "Ташкент",
      territoryId: territoryId ?? undefined,
      agentId: r.pick(agentIds),
      status: "active",
    });
    shopIds.push(Number(s.insertId));
  }

  // ── Заказы ───────────────────────────────────────────────────────────────
  let deletedOrders = 0;
  let withPromise = 0;

  for (let i = 0; i < SANDBOX_ORDER_COUNT; i++) {
    // Назад по дням от «сейчас»: примерно квартал, как и просят фильтры за
    // период.
    const daysAgo = Math.floor((i / SANDBOX_ORDER_COUNT) * 90);
    const createdAt = new Date(now.getTime() - daysAgo * 86_400_000 - r.int(0, 20) * 3_600_000);
    const status = pickStatus(r);
    const shopId = r.pick(shopIds);
    const agentId = r.pick(agentIds);

    const lineCount = r.int(1, 5);
    const lines: Array<{ productId: number; quantity: number; unitPrice: number }> = [];
    let subtotal = 0;
    for (let k = 0; k < lineCount; k++) {
      const p = r.pick(productRows);
      const quantity = r.int(1, 40);
      lines.push({ productId: p.id, quantity, unitPrice: p.price });
      subtotal += quantity * p.price;
    }
    // Скидка бывает не у всех и всегда кратна проценту: так её и ставят руками.
    const discountPct = r.next() < 0.25 ? r.int(1, 10) : 0;
    const discount = Math.round((subtotal * discountPct) / 100);
    const total = subtotal - discount;

    const delivered = status === "delivered";
    const deliveredAt = delivered ? new Date(createdAt.getTime() + r.int(4, 60) * 3_600_000) : null;

    /*
      Обещанный срок стоит НЕ у всех — примерно у двух третей.

      Это главное, что песочница показывает про пункт 17-G: пустое поле
      законно и означает «срок не называли». Заполни его у всех — и получатель
      написал бы разбор просрочек, который развалится на первом же живом
      заказе без обещания.
    */
    const hasPromise = r.next() < 0.66;
    const promisedDeliveryAt = hasPromise
      ? new Date(createdAt.getTime() + r.int(6, 72) * 3_600_000)
      : null;
    if (hasPromise) withPromise++;

    // Немного удалённых: в полной выгрузке их нет, в режиме изменений они
    // приходят с меткой. Без такого примера сверить это нечем.
    const isDeleted = r.next() < 0.03;
    if (isDeleted) deletedOrders++;

    const courierId = delivered || status === "shipped" ? r.pick(courierIds) : null;

    const [o] = await db.insert(orders).values({
      tenantId,
      orderNumber: `SB-${String(i + 1).padStart(5, "0")}`,
      shopId, agentId,
      status: status as "new",
      subtotal: money(subtotal),
      discount: money(discount),
      total: money(total),
      paymentMethod: r.pick(["cash", "card", "transfer", "debt"] as const),
      courierId: courierId ?? undefined,
      deliveryStatus: delivered ? "delivered" : courierId ? "assigned" : "not_assigned",
      promisedDeliveryAt,
      deliveredAt,
      deletedAt: isDeleted ? new Date(createdAt.getTime() + 86_400_000) : null,
      createdAt,
      // Ставим явно: без этого у всех заказов оказалось бы время заполнения, и
      // режим «что изменилось с такого-то времени» отдавал бы разом все
      // триста двадцать.
      updatedAt: deliveredAt ?? createdAt,
    });
    const orderId = Number(o.insertId);

    await db.insert(orderItems).values(lines.map(l => ({
      orderId,
      productId: l.productId,
      quantity: money(l.quantity),
      unitPrice: money(l.unitPrice),
      subtotal: money(l.quantity * l.unitPrice),
    })));
  }

  // Склад песочницы намеренно пуст: первый этап выгрузки — только заказы
  // (пункт 14 ТЗ), и остатки, которых никто не читает, лишь притворялись бы
  // проверенными.
  void warehouseId;

  return {
    orders: SANDBOX_ORDER_COUNT,
    shops: shopIds.length,
    products: productRows.length,
    deletedOrders,
    withPromise,
  };
}
