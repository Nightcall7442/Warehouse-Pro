import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  mediumtext,
  timestamp,
  bigint,
  decimal,
  boolean,
  date,
  time,
  int,
  tinyint,
  json,
  uniqueIndex,
  unique,
  index,
  primaryKey,
} from "drizzle-orm/mysql-core";

// ============================================
// TENANTS — организации (компании)
// ============================================
export const tenants = mysqlTable("tenants", {
  id:            serial("id").primaryKey(),
  slug:          varchar("slug", { length: 100 }).notNull().unique(),
  name:          varchar("name", { length: 255 }).notNull(),
  plan:          mysqlEnum("plan", ["trial", "basic", "pro", "exclusive"]).default("trial").notNull(),
  status:        mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
  // Billing
  trialEndsAt:   timestamp("trial_ends_at"),
  planExpiresAt: timestamp("plan_expires_at"),
  // Limits per plan (null = unlimited)
  /*
    ── Осторожно: max_* тарифом НЕ управляют ─────────────────────────────────

    Эти три поля лежат тут с самого начала и не читаются нигде, кроме карточки
    арендатора в суперадмине. Лимиты берутся из тарифа (PLANS в
    contracts/constants.ts), см. api/lib/plan-limits.ts. Менять их бесполезно:
    на то, что человеку разрешено, они не влияют.

    Убрать бы, но это правка боевой схемы ради порядка — отдельным делом.
  */
  maxUsers:      bigint("max_users", { mode: "number", unsigned: true }),
  maxProducts:   bigint("max_products", { mode: "number", unsigned: true }),
  maxOrdersMonth:bigint("max_orders_month", { mode: "number", unsigned: true }),
  // Contact
  /*
    Докупленные сверх тарифа места и товары.

    Надбавка, а не новый предел: у Basic пятьдесят товаров, докупили двадцать —
    здесь стоит 20, а разрешено 70. Хранить абсолютный предел было бы короче и
    опаснее: при переходе на Pro его пришлось бы пересчитывать руками, а забыв
    это сделать, арендатор остался бы с прежним числом на старшем тарифе.

    Надбавка переживает смену тарифа сама: докупленное остаётся докупленным.
  */
  extraUsers:    int("extra_users").default(0).notNull(),
  extraProducts: int("extra_products").default(0).notNull(),
  ownerEmail:    varchar("owner_email", { length: 320 }),
  ownerPhone:    varchar("owner_phone", { length: 30 }),
  /*
    Песочница для интеграторов.

    Организация с выдуманными данными, на которой чужая сторона проверяет
    выгрузку: листание, снимок, отказы 401/403/429. ТЗ BEKDRINKS требует этого
    прямо (пункт 13): первые испытания — в отдельной среде, и проверять права
    правкой боевых данных нельзя.

    Признак живёт у организации, а не у ключа, потому что отвечает на вопрос
    «чьи это данные», а не «чем их читают». По нему выгрузка помечает КАЖДЫЙ
    свой ответ заголовком среды: перепутать выдуманные числа с настоящими
    нельзя, иначе однажды по ним посчитают настоящий отчёт.
  */
  isSandbox:     boolean("is_sandbox").default(false).notNull(),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Tenant    = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ============================================
// USERS — пользователи (принадлежат тенанту)
// ============================================
export const users = mysqlTable("users", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  name:         varchar("name", { length: 255 }).notNull(),
  email:        varchar("email", { length: 320 }).notNull(),
  passwordHash: varchar("password_hash", { length: 512 }).notNull(),
  avatar:       mediumtext("avatar"),
  phone:        varchar("phone", { length: 20 }),
  role:         mysqlEnum("role", ["superadmin", "ceo", "operator", "agent", "supervisor", "merchandiser", "courier"]).default("agent").notNull(),
  status:       mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  tokenVersion: int("token_version").default(0).notNull(),
  /*
    Второй фактор входа (TOTP). Секрет запечатан secret-box'ом; включён —
    когда стоит totp_enabled_at: секрет без даты — ещё не подтверждённая
    настройка, и на входе он не спрашивается.
  */
  totpSecret:    varchar("totp_secret", { length: 255 }),
  totpEnabledAt: timestamp("totp_enabled_at"),
  pushToken:    text("push_token"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt:     timestamp("lastSignInAt").defaultNow().notNull(),
  telegramChatId:   varchar("telegram_chat_id", { length: 50 }),
  /*
    Язык бота. Спрашивается кнопками при первом обращении и живёт отдельно от
    языка приложения: человек может смотреть отчёты по-русски, а короткие
    сводки в телефоне читать по-узбекски. Пусто — ещё не спрашивали.
  */
  telegramLang:     varchar("telegram_lang", { length: 2 }),
}, (t) => ({
  // email уникален внутри тенанта, но может повторяться в разных тенантах
  emailPerTenant: uniqueIndex("uq_user_email_tenant").on(t.email, t.tenantId),
  tenantIdx:      index("idx_users_tenant").on(t.tenantId),
}));

export type User       = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================
// TERRITORIES — территории (группы магазинов)
// ============================================
export const territories = mysqlTable("territories", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  name:      varchar("name", { length: 255 }).notNull(),
  color:     varchar("color", { length: 7 }),
  centerLat: decimal("center_lat", { precision: 10, scale: 8 }),
  centerLng: decimal("center_lng", { precision: 11, scale: 8 }),
  radiusKm:  decimal("radius_km", { precision: 6, scale: 2 }).default("10.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_territories_tenant").on(t.tenantId),
}));

export type Territory       = typeof territories.$inferSelect;
export type InsertTerritory = typeof territories.$inferInsert;

// ============================================
// SHOPS — торговые точки
// ============================================
export const shops = mysqlTable("shops", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  name:      varchar("name", { length: 255 }).notNull(),
  ownerName: varchar("owner_name", { length: 255 }),
  phone:     varchar("phone", { length: 20 }),
  address:   varchar("address", { length: 500 }),
  city:      varchar("city", { length: 100 }),
  district:  varchar("district", { length: 100 }),
  photoUrl:  mediumtext("photo_url"),
  gpsLat:    decimal("gps_lat", { precision: 10, scale: 8 }),
  gpsLng:    decimal("gps_lng", { precision: 11, scale: 8 }),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  territoryId: bigint("territory_id", { mode: "number", unsigned: true }).references(() => territories.id),
  debt:      decimal("debt", { precision: 12, scale: 2 }).default("0.00").notNull(),
  /*
    Кредитный лимит точки. NULL — без лимита (так у всех до этой правки, и
    ничьё поведение не меняется, пока директор не впишет число).

    Дебиторка — главный операционный риск дистрибьютора; система умела её
    посчитать и состарить, но не умела остановить: заказ «в долг» был открыт
    любому полевому сотруднику без оглядки на долг точки. Агент, мотивированный
    комиссией с оформленного, отгружал в долг магазину с просрочкой.
  */
  creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }),
  status:    mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  notes:     text("notes"),
  /**
   * Метка попытки создания, присланная клиентом.
   *
   * Магазин создавался голой вставкой, без всякой защиты от повтора — в отличие
   * от заказа, у которого таких защит три. Агент в поле жмёт «Создать», связь
   * рвётся до ответа, запись при этом уже закоммичена, он жмёт снова — и в
   * справочнике два одинаковых магазина. В базе на момент правки таких пар и
   * троек 114 групп, с интервалами от нуля до десяти секунд.
   *
   * Столбец необязательный: у 3163 уже заведённых магазинов ключа нет и взять
   * его неоткуда, а уникальный индекс в MySQL не считает NULL-ы одинаковыми,
   * поэтому старые строки не конфликтуют ни между собой, ни с новыми.
   */
  idempotencyKey: varchar("idempotency_key", { length: 64 }),
  /*
    Когда, кем и почему точка убрана из работы.

    Убирать точки система умела и раньше, но не нарочно: «Удалить» пробовал
    стереть строку, а когда внешний ключ не давал — молча переводил status в
    inactive. То есть у одной кнопки было два исхода, и какой достанется,
    зависело от того, успел ли магазин что-нибудь заказать. Стёртое не
    возвращалось, спрятанное оставалось в списке неотличимым от живого, и
    отличить одно от другого на экране было нечем.

    Сам признак «убрана» — это по-прежнему status = 'inactive': по нему уже
    фильтруют агент, KPI, территории и сводка, и заводить рядом второе понятие
    значило бы держать два ответа на один вопрос. Новые столбцы добавляют к
    нему то, чего не хватало, — дату, автора и причину.

    Пустые они у тех точек, что попали в inactive прежним путём: про них
    честно известно только «когда-то убрана», и выдумывать им дату не нужно.
  */
  archivedAt:    timestamp("archived_at"),
  archivedBy:    bigint("archived_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  archiveReason: varchar("archive_reason", { length: 200 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_shops_tenant").on(t.tenantId),
  cityIdx:   index("idx_shops_city").on(t.city),
  districtIdx: index("idx_shops_district").on(t.district),
  agentIdx:    index("idx_shops_agent").on(t.agentId),
  tenantStatusIdx: index("idx_shops_tenant_status").on(t.tenantId, t.status),
  idempotencyUq:   uniqueIndex("uq_shops_idempotency").on(t.tenantId, t.idempotencyKey),
}));

export type Shop       = typeof shops.$inferSelect;
export type InsertShop = typeof shops.$inferInsert;

// ============================================
// PRODUCTS — товары
// ============================================
export const products = mysqlTable("products", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  code:         varchar("code", { length: 50 }).notNull(),
  barcode:      varchar("barcode", { length: 100 }),
  name:         varchar("name", { length: 255 }).notNull(),
  category:     varchar("category", { length: 100 }),
  costPrice:    decimal("cost_price", { precision: 10, scale: 2 }).default("0.00").notNull(),
  unitPrice:    decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  unit:         mysqlEnum("unit", ["kg", "l", "pcs", "box", "pack", "m", "block"]).default("pcs").notNull(),
  unitWeight:   decimal("unit_weight", { precision: 10, scale: 3 }).default("0.000").notNull(),
  /*
    Упаковка: сколько единиц учёта в одной таре (12 бутылок в коробке, 6
    пачек в блоке) и как она называется. Остаток и цена — всегда в единицах
    учёта; упаковка нужна там, где человек считает тарой: «+ коробка» в
    заказе, «коробок» на приёмке, «12 кор. + 3 шт» в загрузочном листе.
    Пусто — тары нет (так было у всех).
  */
  packSize:     decimal("pack_size", { precision: 10, scale: 2 }),
  packLabel:    varchar("pack_label", { length: 30 }),
  description:  text("description"),
  photoUrl:     mediumtext("photo_url"),
  reorderPoint: decimal("reorder_point", { precision: 10, scale: 2 }).default("0.00").notNull(),
  status:       mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  codePerTenant: uniqueIndex("uq_product_code_tenant").on(t.code, t.tenantId),
  tenantIdx:     index("idx_products_tenant").on(t.tenantId),
  barcodeIdx:    index("idx_products_barcode").on(t.barcode),
  tenantCategoryIdx: index("idx_products_tenant_category").on(t.tenantId, t.category),
  tenantStatusIdx:   index("idx_products_tenant_status").on(t.tenantId, t.status),
}));

export type Product       = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// ============================================
// PRICE LISTS — прайс-листы
// ============================================
export const priceLists = mysqlTable("price_lists", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  name:        varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  type:        mysqlEnum("type", ["shop", "tier", "volume"]).default("shop").notNull(),
  isActive:    boolean("is_active").default(true).notNull(),
  priority:    int("priority").default(0).notNull(), // higher = overrides lower
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_price_lists_tenant").on(t.tenantId),
  typeIdx: index("idx_price_lists_type").on(t.type),
}));

export type PriceList       = typeof priceLists.$inferSelect;
export type InsertPriceList = typeof priceLists.$inferInsert;

// ============================================
// PRICE LIST ITEMS — цены в прайс-листе
// ============================================
export const priceListItems = mysqlTable("price_list_items", {
  id:          serial("id").primaryKey(),
  priceListId: bigint("price_list_id", { mode: "number", unsigned: true }).notNull().references(() => priceLists.id, { onDelete: "cascade" }),
  productId:   bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  price:       decimal("price", { precision: 10, scale: 2 }).notNull(),
  minQuantity: decimal("min_quantity", { precision: 10, scale: 2 }).default("1").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  priceListIdx: index("idx_price_list_items_list").on(t.priceListId),
  productIdx: index("idx_price_list_items_product").on(t.productId),
}));

export type PriceListItem       = typeof priceListItems.$inferSelect;
export type InsertPriceListItem = typeof priceListItems.$inferInsert;

// ============================================
// PRICE LIST ASSIGNMENTS — привязка прайс-листа к магазинам
// ============================================
export const priceListAssignments = mysqlTable("price_list_assignments", {
  id:          serial("id").primaryKey(),
  priceListId: bigint("price_list_id", { mode: "number", unsigned: true }).notNull().references(() => priceLists.id, { onDelete: "cascade" }),
  shopId:      bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  priceListIdx: index("idx_pl_assignments_list").on(t.priceListId),
  shopIdx: index("idx_pl_assignments_shop").on(t.shopId),
}));

export type PriceListAssignment       = typeof priceListAssignments.$inferSelect;
export type InsertPriceListAssignment = typeof priceListAssignments.$inferInsert;

// ============================================
// ORDERS — заказы
// ============================================
export const orders = mysqlTable("orders", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  orderNumber: varchar("order_number", { length: 50 }).notNull(),
  shopId:      bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id, { onDelete: "restrict" }),
  agentId:     bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  status:      mysqlEnum("status", ["new", "processing", "shipped", "pending", "delivered", "cancelled", "returned"]).default("new").notNull(),
  subtotal:    decimal("subtotal", { precision: 12, scale: 2 }).default("0.00").notNull(),
  discount:    decimal("discount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  total:       decimal("total", { precision: 12, scale: 2 }).default("0.00").notNull(),
  notes:       text("notes"),
  idempotencyKey: varchar("idempotency_key", { length: 64 }),
  courierId:   bigint("courier_id", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  paymentMethod: mysqlEnum("payment_method", ["cash", "card", "transfer", "debt"]).default("cash").notNull(),
  deliveryStatus: mysqlEnum("delivery_status", ["not_assigned", "assigned", "out_for_delivery", "delivered", "failed"]).default("not_assigned").notNull(),
  /*
    Когда ОБЕЩАЛИ привезти.

    Заводится под интеграцию с супервайзером BEKDRINKS, но нужна не ей: агент
    и без всякой интеграции говорит магазину «привезём в пятницу», и до сих пор
    это жило только в его голове. Срыв обещания измерить было нечем — ни
    отчётом, ни глазами.

    Мгновение, а не день, и ставит его ЧЕЛОВЕК. Соблазн был хранить дату, а
    время дорисовывать концом суток — но тогда система сама придумывает, что
    именно обещали, и по этой выдумке считаются срывы. Экран показывает и дату,
    и время; хочет человек «до конца дня» — он это и выбирает, видя, что
    выбирает.

    Пусто — законное состояние и означает «не обещали». Умолчания здесь нет и
    быть не может: подставленный срок — это чужое обещание от лица агента.
  */
  promisedDeliveryAt: timestamp("promised_delivery_at"),
  /*
    Почему заказ ждёт офиса (status = pending). Скидка полевого сотрудника
    выше порога раньше отказывалась у прилавка; теперь заказ оформляется,
    держит резерв и ждёт подтверждения офиса — а причина стоит здесь, чтобы
    директор видел, ЧТО подтверждает. Стирается, когда заказ выходит из
    ожидания.
  */
  holdReason: varchar("hold_reason", { length: 255 }),
  deliveredAt: timestamp("delivered_at"),
  invoicePrintedAt: timestamp("invoice_printed_at"),
  deliveryResult: varchar("delivery_result", { length: 30 }), // paid, partial_paid, returned, partial_returned
  deliveryNotes:  text("delivery_notes"),
  priority:    mysqlEnum("priority", ["low", "normal", "high"]).default("normal").notNull(),
  deletedAt:   timestamp("deleted_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  /*
    Когда заказ оформили в САМЫЙ первый раз.

    Пусто у всех заказов, кроме тех, что возвращали из архива в работу. У
    таких `created_at` — дата текущего круга (её двигает order-reopen), а
    здесь лежит дата первого оформления, чтобы она не пропала.

    Нужна ровно в одном месте — старение долга: обязательство магазина
    возникло тогда, когда товар уехал в первый раз, и обнулять его возраст
    из-за правки статуса нельзя. Всё остальное — выручка, комиссия, план,
    прогноз спроса — считает текущий круг и берёт `created_at`.
  */
  firstOrderedAt: timestamp("first_ordered_at"),
  updatedAt:   timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
  }, (t) => ({
    orderNumPerTenant: uniqueIndex("uq_order_number_tenant").on(t.orderNumber, t.tenantId),
    idempotencyIdx:    uniqueIndex("uq_orders_idempotency").on(t.idempotencyKey, t.tenantId),
    tenantIdx:         index("idx_orders_tenant").on(t.tenantId),
    tenantStatusIdx:   index("idx_orders_tenant_status").on(t.tenantId, t.status),
    tenantAgentIdx:    index("idx_orders_tenant_agent").on(t.tenantId, t.agentId),
    tenantDateIdx:     index("idx_orders_tenant_date").on(t.tenantId, t.createdAt),
    shopIdx:           index("idx_orders_shop").on(t.shopId),
    agentIdx:          index("idx_orders_agent").on(t.agentId),
    statusIdx:         index("idx_orders_status").on(t.status),
    createdAtIdx:      index("idx_orders_created_at").on(t.createdAt),
    // Существует в базе с миграции 0027, но в модели объявлен не был —
    // расхождение, из-за которого drizzle-kit при следующей генерации попытался
    // бы его «создать заново». Нужен он теперь по-настоящему: фильтр
    // isNull(deleted_at) стоит во ВСЕХ денежных запросах (см.
    // revenueOrderConditions), и без этого индекса они с ростом числа заказов
    // будут отбрасывать удалённые уже после чтения строк.
    tenantDeletedIdx:  index("idx_orders_tenant_deleted").on(t.tenantId, t.deletedAt),

    // ── Ниже: индексы, которые есть на боевой базе с прежних миграций, но в
    // модели объявлены не были. Объявлены здесь 01.09.2026, когда историю
    // миграций свернули в один baseline: baseline собирается ИЗ ЭТОГО ФАЙЛА,
    // и всё, чего тут нет, на новой установке просто не появилось бы. Имена
    // взяты те же, что в базе, — иначе следующая генерация выдала бы пару
    // DROP + CREATE на ровном месте.
    //
    // Курьерская выдача за период и разбор доставок по курьеру.
    courierDateIdx:    index("idx_orders_courier_date").on(t.tenantId, t.courierId, t.createdAt),
    // Отдельно от tenantDeletedIdx: сюда попадают запросы, отбирающие
    // удалённые без привязки к фирме (чистки, сверки).
    deletedAtIdx:      index("idx_orders_deleted_at").on(t.deletedAt),
    // Разрез выручки по способу оплаты — наличные против перечисления.
    paymentMethodIdx:  index("idx_orders_payment_method").on(t.tenantId, t.paymentMethod),
  }));

export type Order       = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// ============================================
// ORDER ITEMS
// ============================================
export const orderItems = mysqlTable("order_items", {
  id:        serial("id").primaryKey(),
  orderId:   bigint("order_id", { mode: "number", unsigned: true }).notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  quantity:  decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  costPrice: decimal("cost_price", { precision: 10, scale: 2 }).default("0.00").notNull(),
  subtotal:  decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  /*
    Откуда взялась цена строки: прайс-лист магазина или карточка товара (NULL).
    Без этого спор «почему в накладной не та цена» разбирался по памяти:
    список могли переименовать или отвязать назавтра. Ссылка мягкая —
    удаление списка не должно трогать проведённые заказы.
  */
  priceListId: bigint("price_list_id", { mode: "number", unsigned: true }),
  // Partial delivery fields
  deliveredQuantity: decimal("delivered_quantity", { precision: 10, scale: 2 }),
  returnReason:      varchar("return_reason", { length: 100 }),
  returnPhotos:      json("return_photos").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orderIdx: index("idx_order_items_order").on(t.orderId),
  productIdx: index("idx_order_items_product").on(t.productId),
  /**
   * Один товар — одна строка в заказе.
   *
   * Весь код, двигающий склад по заказу (create, updateStatus, cancel, delete,
   * restore), собирает один UPDATE с `CASE WHEN product_id = ...`. MySQL берёт
   * первый совпавший WHEN, поэтому вторая строка с тем же товаром молча не
   * резервировалась: в заказе 120 единиц, на складе занято 60. Запрет стоит в
   * базе, а не в одной проверке, чтобы действовать на все пять путей сразу.
   */
  orderProductUq: uniqueIndex("uq_order_items_order_product").on(t.orderId, t.productId),
}));

export type OrderItem       = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// ============================================
// RETURNS — возвраты/брак
// ============================================
export const returns = mysqlTable("returns", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  orderId:      bigint("order_id", { mode: "number", unsigned: true }).references(() => orders.id, { onDelete: "set null" }),
  shopId:       bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id, { onDelete: "restrict" }),
  agentId:      bigint("agent_id", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  returnNumber: varchar("return_number", { length: 50 }).notNull(),
  status:       mysqlEnum("status", ["pending", "approved", "rejected", "completed"]).default("pending").notNull(),
  reason:       mysqlEnum("reason", ["defect", "wrong_item", "expired", "damaged", "other"]).default("other").notNull(),
  /*
    Куда делся вернувшийся товар. Решается при проведении, до того — NULL.

    Раньше каждый проведённый возврат клал товар на полку — и просрочка с
    браком продавались снова следующим же заказом. По умолчанию: брак,
    просрочка и порча списываются, пересорт и «другое» — на склад; оператор
    выбирает при проведении.
  */
  disposition:  mysqlEnum("disposition", ["restock", "write_off"]),
  notes:        text("notes"),
  totalAmount:  decimal("total_amount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  createdBy:    bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_returns_tenant").on(t.tenantId),
  // Возвраты по агенту за период — см. пояснение у orders выше.
  agentDateIdx: index("idx_returns_agent_date").on(t.tenantId, t.agentId, t.createdAt),
  orderIdx: index("idx_returns_order").on(t.orderId),
  shopIdx: index("idx_returns_shop").on(t.shopId),
  statusIdx: index("idx_returns_status").on(t.status),
}));

export type Return       = typeof returns.$inferSelect;
export type InsertReturn = typeof returns.$inferInsert;

// ============================================
// RETURN ITEMS — позиции возврата
// ============================================
export const returnItems = mysqlTable("return_items", {
  id:          serial("id").primaryKey(),
  returnId:    bigint("return_id", { mode: "number", unsigned: true }).notNull().references(() => returns.id, { onDelete: "cascade" }),
  productId:   bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  quantity:    decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice:   decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  subtotal:    decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  reason:      varchar("reason", { length: 255 }),
  condition:   varchar("condition", { length: 255 }), // new, used, damaged, expired
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  returnIdx: index("idx_return_items_return").on(t.returnId),
  productIdx: index("idx_return_items_product").on(t.productId),
}));

export type ReturnItem       = typeof returnItems.$inferSelect;
export type InsertReturnItem = typeof returnItems.$inferInsert;

// ============================================
// WAREHOUSES (multi-warehouse support)
// ============================================
export const warehouses = mysqlTable("warehouses", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  name:        varchar("name", { length: 255 }).notNull(),
  address:     varchar("address", { length: 500 }),
  city:        varchar("city", { length: 100 }),
  isDefault:   boolean("is_default").default(false).notNull(),
  status:      varchar("status", { length: 20 }).default("active").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_warehouses_tenant").on(t.tenantId),
}));

export type Warehouse       = typeof warehouses.$inferSelect;
export type InsertWarehouse = typeof warehouses.$inferInsert;

// ============================================
// STOCK TRANSFERS (inter-warehouse)
// ============================================
export const stockTransfers = mysqlTable("stock_transfers", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  fromWarehouseId: bigint("from_warehouse_id", { mode: "number", unsigned: true }).notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  toWarehouseId:   bigint("to_warehouse_id", { mode: "number", unsigned: true }).notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  productId:     bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  quantity:      decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  status:        varchar("status", { length: 20 }).default("pending").notNull(),
  notes:         text("notes"),
  createdBy:     bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  completedAt:   timestamp("completed_at"),
}, (t) => ({
  tenantIdx:   index("idx_transfers_tenant").on(t.tenantId),
  fromIdx:     index("idx_transfers_from").on(t.fromWarehouseId),
  toIdx:       index("idx_transfers_to").on(t.toWarehouseId),
  statusIdx:   index("idx_transfers_status").on(t.status),
}));

export type StockTransfer       = typeof stockTransfers.$inferSelect;
export type InsertStockTransfer = typeof stockTransfers.$inferInsert;

// ============================================
// WAREHOUSE STOCK
// ============================================
export const warehouseStock = mysqlTable("warehouse_stock", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  warehouseId:  bigint("warehouse_id", { mode: "number", unsigned: true }).references(() => warehouses.id, { onDelete: "restrict" }),
  productId:    bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  currentStock: decimal("current_stock", { precision: 12, scale: 2 }).default("0.00").notNull(),
  reserved:     decimal("reserved", { precision: 12, scale: 2 }).default("0.00").notNull(),
  available:    decimal("available", { precision: 12, scale: 2 }).default("0.00").notNull(),
  /*
    Когда по этой строке уже предупредили «остаток ниже точки заказа».
    Пусто — не предупреждали (или остаток вернулся выше точки, и тревога
    снята). Так каждое пересечение точки даёт ровно одно уведомление, с
    какого бы пути остаток ни ушёл вниз: заказ, курьер, списание, перемещение.
    Своей точки заказа у строки склада нет — она одна, на товаре
    (products.reorder_point); прежняя колонка здесь никем не писалась.
  */
  lowStockAlertedAt: timestamp("low_stock_alerted_at"),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  productWarehouseTenant: uniqueIndex("uq_stock_product_warehouse_tenant").on(t.productId, t.warehouseId, t.tenantId),
  tenantIdx:        index("idx_stock_tenant").on(t.tenantId),
  warehouseIdx:     index("idx_stock_warehouse").on(t.warehouseId),
}));

export type WarehouseStock       = typeof warehouseStock.$inferSelect;
export type InsertWarehouseStock = typeof warehouseStock.$inferInsert;

/* ============================================
   STOCK BATCHES — из чего сложился остаток

   ── Зачем ───────────────────────────────────────────────────────────────────

   warehouse_stock хранит ОДНО число на товар и не помнит, какими партиями оно
   набралось. Пока это так, на вопрос «что сгорает через неделю» ответить
   нечем: срок годности записан на приёмке, но сколько из той партии ещё лежит
   на полке — неизвестно.

   Здесь лежит остаток КАЖДОЙ партии. Отсюда берутся и отчёт «сгорает», и
   порядок списания FEFO: первым уходит то, что раньше портится.

   ── Почему это не второй источник правды ────────────────────────────────────

   Ровно этого и боялись, когда партии записали только на приёмку: параллельный
   учёт разъезжается с остатком за неделю. Разъезжался бы — пока остаток меняли
   девятнадцать мест сырым SQL. Теперь его меняет одна дверь
   (api/services/stock-ledger.ts), и партии двигает она же, тем же вызовом.
   Забыть их негде.

   ── Почему «меньше либо равно», а не «равно» ────────────────────────────────

   Инвариант: SUM(stock_batches.quantity) <= warehouse_stock.current_stock.

   Не равенство, и это осознанно. Партии есть не у всего:

     • товар, лежавший на складе ДО появления этой таблицы;
     • бытовая химия и посуда — у них срока годности нет вовсе;
     • возврат от магазина: какая партия вернулась, никто не записывает, и
       выдумывать её значило бы приписать товару чужой срок.

   Всё это — «остаток без партии». Он существует, продаётся и виден в
   warehouse_stock; просто про его срок сказать нечего. Списание берёт сперва
   партии (по сроку), а остальное — из этого безымянного остатка.
   ============================================ */
export const stockBatches = mysqlTable("stock_batches", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  warehouseId:  bigint("warehouse_id", { mode: "number", unsigned: true }).notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  productId:    bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  /*
    Номер партии и срок — оба необязательны, но хотя бы один обязан быть
    заполнен: строка без того и другого ничем не отличается от безымянного
    остатка и только мешала бы FEFO. Проверяет это дверь, а не колонка:
    сказать об этом надо человеку понятной ошибкой.
  */
  batchNumber:  varchar("batch_number", { length: 64 }),
  expiresAt:    date("expires_at"),
  /*
    Ключ партии — те же два поля, склеенные в одну непустую строку.

    Уникальный индекс нельзя построить прямо по batch_number и expires_at:
    MySQL считает строки с NULL РАЗЛИЧНЫМИ, и партия без номера (только со
    сроком) заводилась бы заново при каждом приходе. `INSERT .. ON DUPLICATE
    KEY UPDATE` тогда никогда не срабатывает, и вместо одной партии на полке
    получается по строке на каждую поставку — FEFO списывал бы из них в
    случайном порядке, а отчёт «что сгорает» показывал бы один товар пятью
    строками.

    Собирает ключ дверь (api/services/stock-ledger.ts), она же и единственная,
    кто сюда пишет.
  */
  batchKey:     varchar("batch_key", { length: 96 }).notNull(),
  /** Сколько от этой партии ещё лежит на складе. */
  quantity:     decimal("quantity", { precision: 12, scale: 2 }).default("0.00").notNull(),
  /** Когда партия пришла — порядок списания при одинаковом сроке. */
  receivedAt:   timestamp("received_at").defaultNow().notNull(),
  /** Строка приёмки, которой партия заведена. Для разбора, откуда она взялась. */
  arrivalItemId: bigint("arrival_item_id", { mode: "number", unsigned: true }),
  /*
    Себестоимость единицы ЭТОЙ партии — с приёмки. Карточка товара держит
    одну цену на всё, а поставки приходят по разным: «сгорает на 4 млн»
    считалось по последней цене карточки, а не по той, за которую партию
    купили. Пусто — партии, заведённые до колонки; тогда берётся карточка.
  */
  costPrice:    decimal("cost_price", { precision: 12, scale: 2 }),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  /*
    Одна строка на партию, а не одна на приход.

    Тот же товар с тем же сроком, привезённый дважды, — это одна партия на
    полке. Две строки означали бы два ответа на вопрос «сколько осталось», и
    FEFO списывал бы из них в случайном порядке.
  */
  oneRowPerBatch: uniqueIndex("uq_batch_product_warehouse")
    .on(t.tenantId, t.warehouseId, t.productId, t.batchKey),
  /** Отчёт «что сгорает» ходит по сроку внутри организации. */
  expiryIdx: index("idx_batches_tenant_expiry").on(t.tenantId, t.expiresAt),
  /** Списание FEFO ищет партии одного товара на одном складе. */
  fefoIdx: index("idx_batches_lookup").on(t.tenantId, t.warehouseId, t.productId),
}));

export type StockBatch       = typeof stockBatches.$inferSelect;
export type InsertStockBatch = typeof stockBatches.$inferInsert;

// ============================================
// STOCK MOVEMENTS
// ============================================
export const stockMovements = mysqlTable("stock_movements", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  productId:     bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  // Which warehouse the goods moved through. Nullable only because rows
  // written before migration 0037 predate the column; new movements always
  // set it (see api/services/stock-ledger.ts).
  warehouseId:   bigint("warehouse_id", { mode: "number", unsigned: true }).references(() => warehouses.id, { onDelete: "set null" }),
  type:          mysqlEnum("type", ["in", "out", "adjustment"]).notNull(),
  quantity:      decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  referenceType: varchar("reference_type", { length: 50 }),
  referenceId:   bigint("reference_id", { mode: "number", unsigned: true }),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_movements_tenant").on(t.tenantId),
  productIdx: index("idx_movements_product").on(t.productId),
  warehouseIdx: index("idx_movements_warehouse").on(t.warehouseId),
  tenantProductIdx: index("idx_movements_tenant_product").on(t.tenantId, t.productId),
  tenantCreatedIdx: index("idx_movements_tenant_created").on(t.tenantId, t.createdAt),
}));

export type StockMovement       = typeof stockMovements.$inferSelect;
export type InsertStockMovement = typeof stockMovements.$inferInsert;

// ============================================
// STOCK COUNTS — инвентаризация
// ============================================
//
// Пересчёт полки был кнопкой «Скорректировать» по одному товару: без
// документа, без «ожидалось / посчитано», без общего итога недостачи. Здесь
// — документ: черновик со снимком остатков на момент начала, строка на
// товар с посчитанным числом, применение одним действием через дверь
// остатка (setStock) и след в журнале. Применённый документ не правится.
export const stockCounts = mysqlTable("stock_counts", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull().references(() => warehouses.id, { onDelete: "restrict" }),
  number:      varchar("number", { length: 30 }).notNull(),
  status:      mysqlEnum("status", ["draft", "applied", "cancelled"]).default("draft").notNull(),
  notes:       text("notes"),
  createdBy:   bigint("created_by", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  appliedBy:   bigint("applied_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  appliedAt:   timestamp("applied_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_stock_counts_tenant").on(t.tenantId, t.createdAt),
}));

export const stockCountItems = mysqlTable("stock_count_items", {
  id:        serial("id").primaryKey(),
  countId:   bigint("count_id", { mode: "number", unsigned: true }).notNull().references(() => stockCounts.id, { onDelete: "cascade" }),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  /** Остаток по учёту на момент, когда строка попала в документ. */
  expected:  decimal("expected", { precision: 12, scale: 2 }).notNull(),
  /** Что насчитали на полке. Пусто — ещё не считали; такая строка при применении пропускается. */
  counted:   decimal("counted", { precision: 12, scale: 2 }),
  note:      varchar("note", { length: 255 }),
}, (t) => ({
  countProductUq: uniqueIndex("uq_stock_count_items_count_product").on(t.countId, t.productId),
}));

export type StockCount     = typeof stockCounts.$inferSelect;
export type StockCountItem = typeof stockCountItems.$inferSelect;

// ============================================
// ARRIVALS — приход фур
// ============================================
export const arrivals = mysqlTable("arrivals", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  arrivalNumber: varchar("arrival_number", { length: 50 }).notNull(),
  truckId:       varchar("truck_id", { length: 100 }),
  driverName:    varchar("driver_name", { length: 255 }),
  driverPhone:   varchar("driver_phone", { length: 20 }),
  status:        mysqlEnum("status", ["pending", "unloading", "completed"]).default("pending").notNull(),
  fuelCost:      decimal("fuel_cost", { precision: 10, scale: 2 }).default("0.00").notNull(),
  tollCost:      decimal("toll_cost", { precision: 10, scale: 2 }).default("0.00").notNull(),
  otherCost:     decimal("other_cost", { precision: 10, scale: 2 }).default("0.00").notNull(),
  totalExpense:  decimal("total_expense", { precision: 12, scale: 2 }).default("0.00").notNull(),
  arrivalDate:   date("arrival_date").notNull(),
  arrivalTime:   time("arrival_time"),
  unloadingTime: time("unloading_time"),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  numPerTenant: uniqueIndex("uq_arrival_number_tenant").on(t.arrivalNumber, t.tenantId),
  tenantIdx:    index("idx_arrivals_tenant").on(t.tenantId),
  tenantStatusIdx: index("idx_arrivals_tenant_status").on(t.tenantId, t.status),
}));

export type Arrival       = typeof arrivals.$inferSelect;
export type InsertArrival = typeof arrivals.$inferInsert;

// ============================================
// ARRIVAL ITEMS
// ============================================
export const arrivalItems = mysqlTable("arrival_items", {
  id:           serial("id").primaryKey(),
  arrivalId:    bigint("arrival_id", { mode: "number", unsigned: true }).notNull().references(() => arrivals.id, { onDelete: "cascade" }),
  productId:    bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "restrict" }),
  quantity:     decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  /*
    Сколько должно было приехать — по накладной поставщика. Пусто — не
    сверяли (так было у всех приходов до этой колонки). Разница с quantity
    — недовоз или излишек: раньше её нигде не было, и спор с поставщиком
    начинался с «а сколько вы вообще ждали?».
  */
  expectedQuantity: decimal("expected_quantity", { precision: 12, scale: 2 }),
  costPrice:    decimal("cost_price", { precision: 10, scale: 2 }).default("0.00"),
  sellingPrice: decimal("selling_price", { precision: 10, scale: 2 }).default("0.00"),
  /*
    Партия и срок годности — записываются там, где товар ВХОДИТ.

    Приход — единственная дверь, через которую продукты появляются на складе с
    известной датой. Не записав срок здесь, его потом неоткуда взять: на
    остатке лежит одно число на товар, без всякой памяти о том, какими
    партиями оно набралось.

    Обе колонки необязательны: у бытовой химии и посуды срока годности нет, и
    заставлять кладовщика придумывать его — верный способ получить «01.01.2099»
    во всех строках.

    Учёт остатка по партиям (списание по FEFO, отчёт «сгорает через неделю»)
    сюда НЕ входит и появится отдельно: остаток меняют девятнадцать мест сырым
    SQL, и параллельный учёт по партиям разъехался бы с ним за неделю.
  */
  batchNumber:  varchar("batch_number", { length: 64 }),
  expiresAt:    date("expires_at"),
  condition:    varchar("condition", { length: 255 }),
  notes:        text("notes"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  arrivalIdx: index("idx_arrival_items_arrival").on(t.arrivalId),
  productIdx: index("idx_arrival_items_product").on(t.productId),
}));

export type ArrivalItem       = typeof arrivalItems.$inferSelect;
export type InsertArrivalItem = typeof arrivalItems.$inferInsert;

// ============================================
// SUPPLIERS — контрагенты, у которых закупается товар
// ============================================
//
// Зеркало долга магазина. shops.debt считает, сколько должны НАМ; здесь
// обратная сторона — сколько должны МЫ поставщику. До этих трёх таблиц
// поставщик в системе не был описан вовсе: приход (arrivals) фиксирует
// разгрузку машины — кто привёз, во сколько обошлась дорога, — но не то, у
// кого товар куплен и сколько за него причитается.
//
// Поставка (supplies) — отдельная сущность от прихода, не его колонка:
// разгрузка машины и обязательство перед поставщиком — разные события,
// которые не всегда совпадают один к одному. arrivalId необязателен и может
// быть NULL: поставка заводится вместе с приходом (обычный случай), но
// бывает и без него — предоплата за ещё не приехавший товар, или несколько
// приходов по одному счёту. Экран «Приход» создаёт оба сразу одной формой.
//
// Долг НЕ хранится полем, а вычисляется запросом: сумма поставки минус
// сумма платежей по ней. У shops.debt ровно эта ловушка уже случалась —
// поле живёт своей жизнью и рано или поздно расходится с фактическими
// платежами. У поставки разойтись нечему: расходится не с чем.

export const suppliers = mysqlTable("suppliers", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  name:        varchar("name", { length: 255 }).notNull(),
  contactName: varchar("contact_name", { length: 255 }),
  phone:       varchar("phone", { length: 32 }),
  inn:         varchar("inn", { length: 32 }),
  address:     varchar("address", { length: 500 }),
  notes:       text("notes"),
  status:      mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  nameUnique: unique("uq_supplier_name_tenant").on(t.name, t.tenantId),
  tenantIdx:       index("idx_suppliers_tenant").on(t.tenantId),
  tenantStatusIdx: index("idx_suppliers_tenant_status").on(t.tenantId, t.status),
}));

export type Supplier       = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// ============================================
// SUPPLIES — поставки: что и на какую сумму должны поставщику
// ============================================
//
// Часть товара ввозная, счёт бывает долларовым. Должны мы тогда именно
// доллары, а не сумму по вчерашнему курсу, поэтому сумма поставки и долг по
// ней живут в валюте счёта (currency), а не пересчитываются в сумы. rateToUzs
// хранится вместе с поставкой для отчётности — сколько сумов это примерно
// составляло на дату поставки, — но на сам долг не влияет: долг остаётся в
// исходной валюте до последнего платежа.
export const supplies = mysqlTable("supplies", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  supplierId:   bigint("supplier_id", { mode: "number", unsigned: true }).notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  arrivalId:    bigint("arrival_id", { mode: "number", unsigned: true }).references(() => arrivals.id, { onDelete: "set null" }),
  supplyNumber: varchar("supply_number", { length: 50 }).notNull(),
  amount:       decimal("amount", { precision: 15, scale: 2 }).notNull(),
  currency:     mysqlEnum("currency", ["UZS", "USD"]).default("UZS").notNull(),
  rateToUzs:    decimal("rate_to_uzs", { precision: 12, scale: 4 }),
  supplyDate:   date("supply_date").notNull(),
  dueDate:      date("due_date"),
  notes:        text("notes"),
  createdBy:    bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  numberUnique: unique("uq_supply_number_tenant").on(t.supplyNumber, t.tenantId),
  tenantIdx:              index("idx_supplies_tenant").on(t.tenantId),
  tenantSupplierDateIdx:  index("idx_supplies_tenant_supplier_date").on(t.tenantId, t.supplierId, t.supplyDate),
  tenantDueIdx:           index("idx_supplies_tenant_due").on(t.tenantId, t.dueDate),
}));

export type Supply       = typeof supplies.$inferSelect;
export type InsertSupply = typeof supplies.$inferInsert;

// ============================================
// SUPPLIER PAYMENTS — платежи поставщику по конкретной поставке
// ============================================
//
// amount — в валюте поставки, тем же полем и тем же смыслом, что и её долг:
// платить можно только в валюте, в которой считается остаток. paidUzs и
// rateToUzs — сколько сумов реально ушло из кассы и по какому курсу; это для
// отчётности, на остаток долга не влияет.
export const supplierPayments = mysqlTable("supplier_payments", {
  id:             serial("id").primaryKey(),
  tenantId:       bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  supplierId:     bigint("supplier_id", { mode: "number", unsigned: true }).notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  supplyId:       bigint("supply_id", { mode: "number", unsigned: true }).notNull().references(() => supplies.id, { onDelete: "restrict" }),
  amount:         decimal("amount", { precision: 15, scale: 2 }).notNull(),
  paidUzs:        decimal("paid_uzs", { precision: 15, scale: 2 }),
  rateToUzs:      decimal("rate_to_uzs", { precision: 12, scale: 4 }),
  /*
    «return» — не деньги, а возвращённый поставщику товар по себестоимости:
    он гасит долг по поставке так же, как платёж, и в акте сверки стоит своей
    строкой. Сам товар уходит со склада движением supplier_return.
  */
  paymentMethod:  mysqlEnum("payment_method", ["cash", "card", "transfer", "return"]).default("transfer").notNull(),
  paidAt:         timestamp("paid_at").defaultNow().notNull(),
  notes:          text("notes"),
  createdBy:      bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  // Двойная отправка одного и того же платежа — сеть отвалилась после ответа,
  // клиент повторил запрос — задвоила бы списание долга. idempotencyKey с
  // уникальностью на (idempotencyKey, tenantId) делает повтор безопасным:
  // тот же ключ второй раз просто не пройдёт вставку.
  idempotencyKey: varchar("idempotency_key", { length: 64 }),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  idemUnique: unique("uq_supplier_payment_idem").on(t.idempotencyKey, t.tenantId),
  tenantIdx:         index("idx_supplier_payments_tenant").on(t.tenantId),
  supplyIdx:         index("idx_supplier_payments_supply").on(t.supplyId),
  tenantSupplierIdx: index("idx_supplier_payments_tenant_supplier").on(t.tenantId, t.supplierId, t.paidAt),
}));

export type SupplierPayment       = typeof supplierPayments.$inferSelect;
export type InsertSupplierPayment = typeof supplierPayments.$inferInsert;

// ============================================
// PAYMENTS
// ============================================
export const payments = mysqlTable("payments", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  shopId:    bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id, { onDelete: "restrict" }),
  orderId:   bigint("order_id", { mode: "number", unsigned: true }).references(() => orders.id, { onDelete: "set null" }),
  amount:    decimal("amount", { precision: 12, scale: 2 }).notNull(),
  type:      mysqlEnum("type", ["payment", "debt"]).default("payment").notNull(),
  // Partial payment fields
  paymentMethod:   mysqlEnum("payment_method", ["cash", "card", "transfer"]).default("cash"),
  status:          varchar("status", { length: 30 }).default("paid"), // paid, partially_paid
  totalOrderAmount: decimal("total_order_amount", { precision: 15, scale: 2 }),
  paidAmount:      decimal("paid_amount", { precision: 15, scale: 2 }),
  debtAmount:      decimal("debt_amount", { precision: 15, scale: 2 }).default("0.00"),
  debtDueDate:     date("debt_due_date"),
  paidAt:          timestamp("paid_at"),
  notes:     text("notes"),
  // Метка одной попытки оплаты. Повтор той же попытки — сорванная связь и
  // повторная отправка, второй клик по кнопке, ретрай 1С — приходит с тем же
  // ключом, и уникальный индекс не даёт записать деньги дважды.
  //
  // Столбец необязательный намеренно: в MySQL уникальный индекс не считает
  // NULL-ы одинаковыми, поэтому все уже существующие платежи с пустым ключом
  // друг другу не мешают, и индекс встаёт на живую таблицу без разбора старых
  // данных.
  idempotencyKey: varchar("idempotency_key", { length: 100 }),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  /*
    Сторно. Платёж не удаляется и не правится: ошибочно введённая оплата
    оставалась навсегда — в собранных наличных курьера, в акте сверки, в
    журнале долгов, — и исправлялась только ручным «новым долгом», который в
    акте читался как начисление. Сторно — вторая строка того же типа с
    отрицательной суммой и ссылкой сюда: все суммы по type = 'payment'
    (долг магазина, касса курьера, ведомость) сходятся сами, а пара строк
    видна как пара. Одно сторно на платёж — уникальный индекс ниже.
  */
  reversalOf: bigint("reversal_of", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_payments_tenant").on(t.tenantId),
  shopIdx:   index("idx_payments_shop").on(t.shopId),
  orderIdx:  index("idx_payments_order").on(t.orderId),
  tenantShopIdx: index("idx_payments_tenant_shop").on(t.tenantId, t.shopId),
  createdAtIdx:  index("idx_payments_created_at").on(t.createdAt),
  idempotencyUq: uniqueIndex("uq_payments_idempotency").on(t.tenantId, t.idempotencyKey),
  reversalUq: uniqueIndex("uq_payments_reversal_of").on(t.reversalOf),
}));

export type Payment       = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

// ============================================
// AGENT LOCATIONS — GPS трекинг
// ============================================
export const agentLocations = mysqlTable("agent_locations", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  lat:       decimal("lat", { precision: 10, scale: 8 }).notNull(),
  lng:       decimal("lng", { precision: 11, scale: 8 }).notNull(),
  accuracy:  decimal("accuracy", { precision: 8, scale: 2 }),
  batteryLevel: int("battery_level"),
  /**
   * Когда точка снята устройством. Со слов устройства.
   *
   * Точки копятся в буфере, пока агент вне зоны покрытия, и заливаются пачкой
   * при первом же сигнале. Раньше времени съёмки не было вовсе, и сервер
   * ставил время вставки: на карте супервайзера агент весь день «стоял» на
   * месте последней связи, а в 17:40 мгновенно проезжал весь маршрут. На
   * вопрос «где ты был в 14:20» ответить было нечем, хотя точка физически
   * сохранена.
   *
   * created_at остаётся временем ПОЛУЧЕНИЯ сервером и не заменяется этим
   * полем. Разница принципиальная: время съёмки приходит от клиента, и
   * проверить его нельзя — на нём нельзя строить проверку геозоны, иначе
   * агент сможет задним числом «оказаться» где угодно. Поэтому anti-fraud
   * по-прежнему считает по created_at, а recorded_at служит для показа.
   * Расхождение между ними само по себе полезно: видно, что точка пролежала
   * в буфере три часа.
   */
  recordedAt: timestamp("recorded_at"),
  /*
    Точка снята с подменённых координат — так сказала система телефона
    (Android отмечает фиктивное местоположение от приложений-эмуляторов).
    Единственный признак фрода, который нельзя получить честно: отсутствие
    GPS бывает у всех, подмена — только нарочно.
  */
  mocked: boolean("mocked").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_locations_tenant").on(t.tenantId),
  /*
    Все шесть чтений следа фильтруют tenant_id + agent_id + диапазон
    created_at. Индекс (tenant_id, agent_id) без времени заставлял InnoDB
    перебирать всю историю агента и отсеивать по дате — карта супервайзера,
    KPI и антифрод за день читали месяцы. Третья колонка делает диапазон
    частью индекса; прежний двухколоночный индекс — префикс этого и не нужен.
  */
  tenantAgentCreatedIdx: index("idx_locations_tenant_agent_created").on(t.tenantId, t.agentId, t.createdAt),
  tenantCreatedIdx: index("idx_locations_tenant_created").on(t.tenantId, t.createdAt),
}));

export type AgentLocation       = typeof agentLocations.$inferSelect;
export type InsertAgentLocation = typeof agentLocations.$inferInsert;

// ============================================
// DAILY PLANS
// ============================================
export const dailyPlans = mysqlTable("daily_plans", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  shopId:    bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id, { onDelete: "restrict" }),
  planDate:  date("plan_date").notNull(),
  status:    mysqlEnum("status", ["planned", "visited", "skipped"]).default("planned").notNull(),
  // When the visit happened, as distinct from updatedAt, which moves whenever
  // anything on the row is edited. Null for plans recorded before this existed.
  visitedAt: timestamp("visited_at"),
  photoUrl:  mediumtext("photo_url"),
  notes:     text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_plans_tenant").on(t.tenantId),
  tenantDateIdx: index("idx_plans_tenant_date").on(t.tenantId, t.planDate),
  tenantAgentIdx: index("idx_plans_tenant_agent").on(t.tenantId, t.agentId),
  shopIdx:   index("idx_plans_shop").on(t.shopId),
  statusIdx: index("idx_plans_status").on(t.status),
}));

export type DailyPlan       = typeof dailyPlans.$inferSelect;
export type InsertDailyPlan = typeof dailyPlans.$inferInsert;

// ============================================
// VISIT SCHEDULES — recurring visit templates
// ============================================
export const visitSchedules = mysqlTable("visit_schedules", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  shopId:    bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id, { onDelete: "restrict" }),
  dayOfWeek: tinyint("day_of_week").notNull(), // 0=Sunday, 1=Monday, ..., 6=Saturday
  active:    boolean("active").default(true).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx:     index("idx_schedules_tenant").on(t.tenantId),
  agentIdx:      index("idx_schedules_agent").on(t.agentId),
  shopIdx:       index("idx_schedules_shop").on(t.shopId),
  tenantAgentIdx: index("idx_schedules_tenant_agent").on(t.tenantId, t.agentId),
  uniqueEntry:   unique("uq_schedule_agent_shop_day").on(t.agentId, t.shopId, t.dayOfWeek),
}));

export type VisitSchedule       = typeof visitSchedules.$inferSelect;
export type InsertVisitSchedule = typeof visitSchedules.$inferInsert;

// ============================================
// AGENT TERRITORIES — рабочие зоны агентов
// ============================================
export const agentTerritories = mysqlTable("agent_territories", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  agentId:     bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  territoryId: bigint("territory_id", { mode: "number", unsigned: true }).notNull().references(() => territories.id, { onDelete: "restrict" }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:    index("idx_agent_territories_tenant").on(t.tenantId),
  agentIdx:     index("idx_agent_territories_agent").on(t.agentId),
  territoryIdx: index("idx_agent_territories_territory").on(t.territoryId),
  uniqueEntry:  unique("uq_agent_territory").on(t.agentId, t.territoryId),
}));

export type AgentTerritory       = typeof agentTerritories.$inferSelect;
export type InsertAgentTerritory = typeof agentTerritories.$inferInsert;

// ============================================
// SALES TARGETS — планы продаж (план/факт)
// ============================================
export const salesTargets = mysqlTable("sales_targets", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  userId:       bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  shopId:       bigint("shop_id", { mode: "number", unsigned: true }).references(() => shops.id, { onDelete: "restrict" }),
  territoryId:  bigint("territory_id", { mode: "number", unsigned: true }).references(() => territories.id, { onDelete: "restrict" }),
  periodType:   mysqlEnum("period_type", ["daily", "weekly", "monthly"]).default("monthly").notNull(),
  periodStart:  date("period_start").notNull(),
  periodEnd:    date("period_end").notNull(),
  targetAmount: decimal("target_amount", { precision: 14, scale: 2 }).notNull(),
  actualAmount: decimal("actual_amount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  orderCountTarget:  int("order_count_target"),
  visitTarget:       decimal("visit_target", { precision: 5, scale: 2 }),
  actualOrderCount:  int("actual_order_count").default(0).notNull(),
  actualVisitPct:    decimal("actual_visit_pct", { precision: 5, scale: 2 }).default("0.00").notNull(),
  notes:        text("notes"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_sales_targets_tenant").on(t.tenantId),
  userPeriodIdx: index("idx_sales_targets_user_period").on(t.userId, t.periodType, t.periodStart),
  tenantPeriodIdx: index("idx_sales_targets_tenant_period").on(t.tenantId, t.periodType, t.periodStart),
  territoryIdx: index("idx_sales_targets_territory").on(t.territoryId),
}));

export type SalesTarget       = typeof salesTargets.$inferSelect;
export type InsertSalesTarget = typeof salesTargets.$inferInsert;

// ============================================
// COMMISSIONS — комиссии агентов
// ============================================
export const commissions = mysqlTable("commissions", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  userId:       bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("0.00").notNull(), // percentage
  /*
    Сколько платить курьеру ЗА ОДНУ доставку — в сумах, не в процентах.

    Комиссия процентом курьеру не подходит: сумму заказа он не назначает и на
    неё не влияет, а везёт одинаково — что коробку на сто тысяч, что на
    миллион. Поэтому у него своя ставка, и живёт она здесь же: таблица и так
    означает «как человеку считают переменную часть в этом периоде», и вторая
    строка в ней уместнее второй таблицы.
  */
  deliveryRate: decimal("delivery_rate", { precision: 12, scale: 2 }).default("0.00").notNull(),
  /*
    Чем платят курьеру: суммой за довезённую заявку или процентом.

    Способ хранится ЯВНО, а не выводится из того, какое поле заполнено. Вывести
    было бы короче: стоит ставка — платим за штуку, стоит процент — процентом.
    Но заполнены могут оказаться оба (например, курьера перевели с одного на
    другой, не обнулив прежнее), и тогда правило приходится додумывать — а речь
    о зарплате, где догадка кончается спором с человеком, который недосчитался
    денег.

    За штуку — по умолчанию: так платят у большинства, и так считалось до
    появления выбора. Процент берётся из commission_rate — того же поля, что и
    у агента, потому что это тот же самый процент, только от другой суммы: у
    агента от оформленного, у курьера от довезённого.
  */
  courierPayMode: mysqlEnum("courier_pay_mode", ["per_delivery", "percent"]).default("per_delivery").notNull(),
  /*
    Обед и дорожные — суммы ЗА ОДИН РАБОЧИЙ ДЕНЬ, в сумах.

    Арендатор: «доставщики берут деньги на обед и дорожные, они тоже должны
    считаться». Эти деньги выдавались наличными в течение месяца и не
    попадали никуда: ни в зарплату курьера, ни в расходы организации. В конце
    месяца ему платили полный расчёт сверх уже выданного, а прибыль
    показывалась завышенной ровно на эту сумму.

    За день, а не за месяц: курьер, отработавший половину месяца, обедает
    половину месяца. Рабочим днём считается день, в который он что-то довёз, —
    другого следа выхода на работу в системе нет, и выдумывать табель ради
    двух сумм не стоит.
  */
  /*
    Оклад. Жил в sales_targets.target_amount — в той же колонке, куда экран
    «Нормы месяца» и мобильный экран целей пишут ПЛАН ПРОДАЖ. Одно число, два
    смысла, два независимых пути записи: супервайзер применял подсказанные
    нормы (45 млн выручки) — в ведомости у агента появлялся оклад 45 млн и от
    него считался вычет; директор ставил оклад 3 млн — план агента становился
    3 млн. Здесь оклад лежит рядом со ставкой, обедом и дорожными — это одна
    строка условий оплаты человека на месяц.
  */
  baseSalary:      decimal("base_salary",      { precision: 14, scale: 2 }).default("0.00").notNull(),
  /*
    Утверждённый вычет за подозрительные визиты — за ЭТОТ период.

    Раньше вычет считался формулой (оклад × доля подозрительных × ½) и
    вычитался из зарплаты сам, без чьего-либо решения и без строки в
    ведомости супервайзера: человек недосчитывался денег за день без GPS.
    Теперь формула даёт ПРЕДЛОЖЕНИЕ, а из зарплаты вычитается только то, что
    директор утвердил здесь. NULL — не утверждали, вычета нет.
  */
  fraudDeduction:  decimal("fraud_deduction",  { precision: 14, scale: 2 }),
  mealAllowance:   decimal("meal_allowance",   { precision: 12, scale: 2 }).default("0.00").notNull(),
  travelAllowance: decimal("travel_allowance", { precision: 12, scale: 2 }).default("0.00").notNull(),
  periodType:   mysqlEnum("period_type", ["monthly", "quarterly"]).default("monthly").notNull(),
  periodStart:  date("period_start").notNull(),
  periodEnd:    date("period_end").notNull(),
  salesAmount:  decimal("sales_amount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  commissionAmount: decimal("commission_amount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  status:       mysqlEnum("status", ["pending", "approved", "paid"]).default("pending").notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_commissions_tenant").on(t.tenantId),
  userPeriodIdx: index("idx_commissions_user_period").on(t.userId, t.periodType, t.periodStart),
}));

export type Commission       = typeof commissions.$inferSelect;
export type InsertCommission = typeof commissions.$inferInsert;

// ============================================
// COMMISSION PRODUCT RATES — процент по ТОВАРУ
// ============================================
//
// Жалоба арендатора: «система процентов для агентов неправильная, потому что
// он поставил разные проценты для разных товаров». В commissions процент
// один на человека и на всё, что он продал, — а торгуют товарами с разной
// наценкой, и платить с них поровну владелец не хочет.
//
// Ставка привязана к ТОВАРУ, а не к паре «человек + товар». Так решается
// именно та задача, о которой речь: у товара своя наценка, и процент с него
// свой независимо от того, кто продал. Пара «человек + товар» означала бы
// для организации с десятью агентами и пятью особыми товарами полсотни
// строк, которые надо завести руками, — то есть ровно ту ручную работу, от
// которой этот раздел и заводится.
//
// Товара нет в таблице — действует процент человека из commissions. То есть
// пустая таблица считает ровно так же, как считалось до её появления: это не
// новый режим, а исключения из старого.
export const commissionProductRates = mysqlTable("commission_product_rates", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id, { onDelete: "cascade" }),
  rate:      decimal("rate", { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  // Одна ставка на товар. Без запрета вторая строка молча выигрывала бы или
  // проигрывала по порядку чтения — то есть процент зависел бы от того, в
  // каком порядке база вернула строки.
  tenantProductUq: uniqueIndex("uq_commission_product_rates").on(t.tenantId, t.productId),
}));

export type CommissionProductRate       = typeof commissionProductRates.$inferSelect;
export type InsertCommissionProductRate = typeof commissionProductRates.$inferInsert;

// ============================================
// SALARY PAYOUTS — что человеку отдали на руки
// ============================================
//
// Начисление и выплата — разные события, и до этой таблицы в системе было
// только первое. kpi.salaryReport считает, сколько человеку причитается за
// период, но кому и когда деньги отдали, не знал никто: этот учёт вёлся
// вне программы, а значит спор «мне не платили» разрешать было нечем.
//
// Аванс — та же выдача денег, отличается лишь тем, что происходит до конца
// периода, поэтому это вид записи (kind), а не отдельная таблица: остаток к
// выплате он уменьшает ровно так же.
//
// Записи только добавляются. Изменять и удалять их нечем намеренно: на этом
// держится вся ценность журнала — ошибочную выдачу гасят встречной записью,
// а не подчисткой. По той же причине здесь хранится createdBy: у каждой
// суммы есть тот, кто её выдал.
export const salaryPayouts = mysqlTable("salary_payouts", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  userId:       bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  kind:         mysqlEnum("kind", ["payout", "advance"]).default("payout").notNull(),
  amount:       decimal("amount", { precision: 14, scale: 2 }).notNull(),
  paidAt:       timestamp("paid_at").defaultNow().notNull(),
  note:         varchar("note", { length: 255 }),
  /*
    Когда САМ сотрудник подтвердил, что деньги получил.

    Запись выплаты говорит «мы выдали», и до этой колонки другой стороны у
    неё не было: спор «мне не платили» упирался в слово против слова, а
    подпись в тетради к системе отношения не имела.

    Пусто — не «не получил», а «ещё не подтвердил»: деньги могли отдать в
    руки, а телефон человек откроет вечером. Поэтому подтверждение ничего в
    расчётах не меняет и ничего не блокирует — оно только отвечает на вопрос
    «а он подтвердил?».
  */
  confirmedAt:  timestamp("confirmed_at"),
  createdBy:    bigint("created_by", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_salary_payouts_tenant").on(t.tenantId, t.paidAt),
  userIdx:   index("idx_salary_payouts_user").on(t.userId, t.paidAt),
}));

export type SalaryPayout       = typeof salaryPayouts.$inferSelect;
export type InsertSalaryPayout = typeof salaryPayouts.$inferInsert;

// ============================================
// NOTIFICATIONS
// ============================================
export const notifications = mysqlTable("notifications", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  userId:    bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  type:      mysqlEnum("type", ["order", "payment", "stock", "system"]).notNull(),
  title:     varchar("title", { length: 255 }).notNull(),
  message:   text("message"),
  isRead:    boolean("is_read").default(false).notNull(),
  link:      varchar("link", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_notif_tenant").on(t.tenantId),
  userTenantIdx: index("idx_notif_user_tenant").on(t.userId, t.tenantId),
  userTenantReadIdx: index("idx_notif_user_tenant_read").on(t.userId, t.tenantId, t.isRead),
  /*
    Под ночную уборку: «прочитанные старше месяца», «непрочитанные старше трёх».
    Все прежние ключи начинаются с организации или человека, а уборка идёт по
    всей таблице разом — без этого она читала бы её целиком каждую ночь, и чем
    дальше, тем дольше.
  */
  purgeIdx: index("idx_notif_purge").on(t.isRead, t.createdAt),
}));

export type Notification       = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ============================================
// SETTINGS — настройки компании (1 строка на тенант)
// ============================================
export const settings = mysqlTable("settings", {
  id:                  serial("id").primaryKey(),
  tenantId:            bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }).unique(),
  companyName:         varchar("company_name", { length: 255 }).default("Warehouse Pro").notNull(),
  currency:            varchar("currency", { length: 10 }).default("UZS").notNull(),
  currencySymbol:      varchar("currency_symbol", { length: 10 }).default("сум").notNull(),
  defaultReorderPoint: decimal("default_reorder_point", { precision: 10, scale: 2 }).default("0.00").notNull(),
  lowStockThreshold:   decimal("low_stock_threshold", { precision: 10, scale: 2 }).default("50.00").notNull(),
  /*
    Порог скидки для полевых ролей (агент, мерчандайзер, супервайзер), в
    процентах. NULL — порога нет, как было у всех: заказ со скидкой до 100 %
    мог оформить любой полевой сотрудник без согласования и без записи в
    журнал — классическая схема «своему магазину со скидкой», при которой
    склад и долг сходятся, а P&L показывает падение маржи без объяснения.
    Скидка выше порога — отказ у прилавка; заказ со скидкой выше порога
    оформляет офис (ceo, operator), и это остаётся в журнале действий.
  */
  maxFieldDiscountPct: decimal("max_field_discount_pct", { precision: 5, scale: 2 }),
  symbolPosition:      mysqlEnum("symbol_position", ["before", "after"]).default("after").notNull(),
  // UZ: address for official documents (printed on invoices)
  companyAddress:      text("company_address"),
  companyPhone:        varchar("company_phone", { length: 50 }),
  companyInn:          varchar("company_inn", { length: 50 }),     // ИНН / СТИР
  companyDirector:     varchar("company_director", { length: 255 }),
  companyBank:         varchar("company_bank", { length: 255 }),
  companyBankAccount:  varchar("company_bank_account", { length: 50 }),
  companyMfo:          varchar("company_mfo", { length: 20 }),      // МФО банка
  logoUrl:             text("logo_url"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
  updatedAt:           timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Setting       = typeof settings.$inferSelect;
export type InsertSetting = typeof settings.$inferInsert;

// ============================================
// SUBSCRIPTIONS — Stripe billing
// ============================================
export const subscriptions = mysqlTable("subscriptions", {
  id:                   varchar("id", { length: 36 }).primaryKey(),
  tenantId:             bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }).unique(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  stripeCustomerId:     varchar("stripe_customer_id", { length: 255 }),
  plan:                 mysqlEnum("plan", ["trial", "basic", "pro", "exclusive"]).default("trial").notNull(),
  status:               mysqlEnum("status", ["trialing", "active", "past_due", "canceled", "incomplete"]).default("trialing").notNull(),
  trialEndsAt:          timestamp("trial_ends_at"),
  currentPeriodEnds:    timestamp("current_period_ends"),
  createdAt:            timestamp("created_at").defaultNow().notNull(),
  updatedAt:            timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx:    index("idx_sub_tenant").on(t.tenantId),
  stripeSubIdx: index("idx_sub_stripe").on(t.stripeSubscriptionId),
}));

export type Subscription       = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ============================================
// BILLING EVENTS — Stripe webhook log
// ============================================
export const billingEvents = mysqlTable("billing_events", {
  id:            varchar("id", { length: 36 }).primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  type:          varchar("type", { length: 100 }).notNull(),
  stripeEventId: varchar("stripe_event_id", { length: 255 }).unique(),
  payload:       text("payload"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_billing_events_tenant").on(t.tenantId),
}));

export type BillingEvent       = typeof billingEvents.$inferSelect;
export type InsertBillingEvent = typeof billingEvents.$inferInsert;

// ============================================
// INVITES — email invitations
// ============================================
export const invites = mysqlTable("invites", {
  id:         varchar("id", { length: 36 }).primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  email:      varchar("email", { length: 320 }).notNull(),
  role:       mysqlEnum("role", ["operator", "agent", "supervisor", "merchandiser", "courier"]).notNull(),
  token:      varchar("token", { length: 64 }).notNull().unique(),
  expiresAt:  timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdBy:  bigint("created_by", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tokenIdx:  index("idx_invites_token").on(t.token),
  tenantIdx: index("idx_invites_tenant").on(t.tenantId),
}));

export type Invite       = typeof invites.$inferSelect;
export type InsertInvite = typeof invites.$inferInsert;

// ============================================
// TENANT BRANDING — white label configuration
// ============================================
export const tenantBranding = mysqlTable("tenant_branding", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }).unique(),
  logoUrl:       text("logo_url"),
  primaryColor:  varchar("primary_color", { length: 7 }).default("#2563eb"),
  secondaryColor:varchar("secondary_color", { length: 7 }).default("#1e40af"),
  accentColor:   varchar("accent_color", { length: 7 }).default("#3b82f6"),
  /** Не используется: имя компании берётся из settings (раздел «Компания»). */
  companyName:   varchar("company_name", { length: 255 }),
  appName:       varchar("app_name", { length: 255 }).default("Warehouse Pro"),
  supportEmail:  varchar("support_email", { length: 320 }),
  supportPhone:  varchar("support_phone", { length: 50 }),
  // White-label extensions
  /*
    Домен пока не разбирается: арендатор определяется по токену, и запрос не
    смотрит на Host. Столбец оставлен под будущий разбор, роутер его не пишет.
  */
  customDomain:  varchar("custom_domain", { length: 255 }),
  /*
    Значок вкладки хранится строкой data:image/…;base64,… — как и логотип.
    Здесь стояло varchar(500): в такой столбец не помещается ни одна картинка,
    и загрузка значка отклоняла весь запрос целиком, вместе с цветами.
  */
  faviconUrl:    text("favicon_url"),
  loginTitle:    varchar("login_title", { length: 100 }),
  loginSubtitle: varchar("login_subtitle", { length: 255 }),
  footerText:    varchar("footer_text", { length: 500 }),
  mobileTheme:   varchar("mobile_theme", { length: 10 }).default("auto"),
  /*
    Реквизиты живут в settings и правятся в разделе «Компания» — там же адрес,
    директор и банк, которые печатаются на счёте. Эти два столбца остались от
    прежнего замысла: не читаются и не пишутся, второе место для того же ИНН
    разошлось бы с первым в тот же день.
  */
  inn:           varchar("inn", { length: 20 }),
  legalAddress:  varchar("legal_address", { length: 500 }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_branding_tenant").on(t.tenantId),
}));

export type TenantBranding       = typeof tenantBranding.$inferSelect;
export type InsertTenantBranding = typeof tenantBranding.$inferInsert;

// ============================================
// ID MAPPINGS — 1C UUID ↔ internal ID
// ============================================
export const idMappings = mysqlTable("id_mappings", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull(),
  entityType:    varchar("entity_type", { length: 50 }).notNull(),
  externalId:    varchar("external_id", { length: 100 }).notNull(),
  internalId:    bigint("internal_id", { mode: "number", unsigned: true }).notNull(),
  lastSyncedAt:  timestamp("last_synced_at").defaultNow(),
  createdAt:     timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("uk_mapping").on(t.tenantId, t.entityType, t.externalId),
  index("idx_mapping_internal").on(t.tenantId, t.entityType, t.internalId),
]);

export type IdMapping       = typeof idMappings.$inferSelect;
export type InsertIdMapping = typeof idMappings.$inferInsert;

// ============================================
// SYNC STATUS — статус синхронизации с 1С
// ============================================
export const syncStatus = mysqlTable('sync_status', {
  id:                  serial('id').primaryKey(),
  tenantId:            bigint('tenant_id', { mode: 'number', unsigned: true }).notNull(),
  entityType:          varchar('entity_type', { length: 50 }).notNull(),
  direction:           varchar('direction', { length: 20 }).notNull(),
  status:              varchar('status', { length: 20 }).notNull(),
  recordsProcessed:    int('records_processed').default(0),
  lastSuccessfulSync:  timestamp('last_successful_sync'),
  errorCount:          int('error_count').default(0),
  lastError:           text('last_error'),
  createdAt:           timestamp('created_at').defaultNow(),
  updatedAt:           timestamp('updated_at').defaultNow(),
}, (t) => ({
  tenantIdx: index('idx_sync_status_tenant').on(t.tenantId),
  entityIdx: index('idx_sync_status_entity').on(t.tenantId, t.entityType),
}));

export type SyncStatus       = typeof syncStatus.$inferSelect;
export type InsertSyncStatus = typeof syncStatus.$inferInsert;

// ============================================
// VISIT REPORTS — отчёты о визитах мерчандайзеров
// ============================================
export const visitReports = mysqlTable("visit_reports", {
  id:             bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  tenantId:       bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  shopId:         bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id, { onDelete: "restrict" }),
  userId:         bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  planId:         bigint("plan_id", { mode: "number", unsigned: true }).notNull().references(() => dailyPlans.id, { onDelete: "cascade" }),
  photos:         json("photos").$type<string[]>().default([]),
  checklist:      json("checklist").$type<Array<{
    productId: number;
    productName: string;
    present: boolean;
    price?: string;
    promoNote?: string;
  }>>().default([]),
  competitorNotes: text("competitor_notes"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantShop: index("idx_vr_tenant_shop").on(t.tenantId, t.shopId),
  tenantPlan: index("idx_vr_tenant_plan").on(t.tenantId, t.planId),
  tenantUser: index("idx_vr_tenant_user").on(t.tenantId, t.userId),
  // Отчёты сотрудника за период — см. пояснение у orders выше.
  userDate:   index("idx_visit_reports_user_date").on(t.tenantId, t.userId, t.createdAt),
}));

export type VisitReport       = typeof visitReports.$inferSelect;
export type InsertVisitReport = typeof visitReports.$inferInsert;

// ============================================
// AUDIT LOG — журнал чувствительных действий
// ============================================
export const auditLog = mysqlTable("audit_log", {
  id:         serial("id").primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  actorId:    bigint("actor_id", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  actorName:  varchar("actor_name", { length: 100 }),
  action:     varchar("action", { length: 100 }).notNull(),
  targetType: varchar("target_type", { length: 50 }),
  targetId:   bigint("target_id", { mode: "number", unsigned: true }),
  meta:       json("meta"),
  ip:         varchar("ip", { length: 45 }),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:   index("idx_audit_tenant_created").on(t.tenantId, t.createdAt),
  tenantAction: index("idx_audit_tenant_action").on(t.tenantId, t.action),
  actorIdx:    index("idx_audit_actor").on(t.actorId),
}));

export type AuditLogEntry    = typeof auditLog.$inferSelect;
export type InsertAuditLog   = typeof auditLog.$inferInsert;

// ============================================
// PASSWORD RESET TOKENS — self-service recovery
// ============================================
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id:        serial("id").primaryKey(),
  userId:    bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt:    timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tokenIdx: uniqueIndex("uq_reset_token_hash").on(t.tokenHash),
  userIdx:  index("idx_reset_user").on(t.userId),
}));

export type PasswordResetToken    = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ============================================
// API KEYS — public REST API access (Exclusive tier)
// ============================================
export const apiKeys = mysqlTable("api_keys", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  name:        varchar("name", { length: 100 }).notNull(),
  keyHash:     varchar("key_hash", { length: 64 }).notNull(),
  keyPrefix:   varchar("key_prefix", { length: 12 }).notNull(),   // first 8 chars for display: "wp_live_..."
  scopes:      varchar("scopes", { length: 500 }).default("read").notNull(), // comma-separated: read,write,orders,products,stock
  rateLimit:   int("rate_limit").default(100).notNull(),       // requests per minute
  lastUsedAt:  timestamp("last_used_at"),
  expiresAt:   timestamp("expires_at"),
  status:      varchar("status", { length: 20 }).default("active").notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:  index("idx_apikey_tenant").on(t.tenantId),
  keyIdx:     uniqueIndex("uq_apikey_hash").on(t.keyHash),
  prefixIdx:  index("idx_apikey_prefix").on(t.keyPrefix),
}));

export type ApiKey       = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// ============================================
// API EXPORT LOG — что и когда мы отдали наружу
// ============================================
/*
  Журнал выгрузок наружу.

  ── Зачем ─────────────────────────────────────────────────────────────────

  Приёмка (пункт 17-H) требует суточного испытания, в котором записаны
  последняя успешная выгрузка и ошибки. Без журнала на вопрос «мы не получили
  заказы за вторник» ответить нечем: у нас нет ни следа того, что мы отдали,
  ни того, чем ответили.

  Это НАША половина правды: что мы отдали и чем ответили. Вторая половина —
  что получатель разобрал и сошлась ли у него сверка — живёт у него, и
  выдавать её за свою нельзя.

  ── Что здесь есть и чего нет ─────────────────────────────────────────────

  Есть точка возобновления (курсор), числа сверки (строк, итог, сумма) и
  ответ. Нет ни одного заказа: журнал обращений не должен становиться второй
  копией заказов.

  Живёт тридцать дней — уборка в cron/scheduler.ts. Суточное испытание в него
  укладывается с большим запасом, а расти без конца журналу обращений нельзя.
*/
// ============================================
// TELEGRAM GROUPS — общий чат сотрудников организации
// ============================================
/*
  Группа сотрудников в Telegram.

  ── Зачем ─────────────────────────────────────────────────────────────────

  Подключиться к боту сотрудник может только сам: ссылка подписана его
  идентификатором и живёт четверть часа. Это правильно — иначе пересланная
  ссылка стала бы способом читать чужие уведомления, — но из этого следовало
  неудобное: чтобы уведомления получала вся смена, каждого надо уговорить
  проделать это лично. У организации на двадцать человек так не выходит
  никогда.

  Группа решает это одним действием директора: он заводит чат, добавляет туда
  бота и связывает чат с организацией. Дальше рабочие события видят все, кто в
  чате, — включая тех, кто ничего не подключал.

  ── Что в группу НЕ уходит ────────────────────────────────────────────────

  Ничего личного. Зарплата, свои показатели, персональные задачи адресованы
  ОДНОМУ человеку, и в общем чате это разглашение, а не удобство. Такие
  уведомления идут с указанием получателя, и в группу они не попадают — за
  этим следит проверка.

  ── Почему одна группа на организацию ─────────────────────────────────────

  Потому что вопрос «в какой из групп это событие» пришлось бы решать
  настройкой, которую никто не заполнит. Одна группа отвечает на «пусть смена
  видит» — а это и есть вся просьба. Понадобится разделение по отделам —
  станет отдельным решением, а не догадкой заранее.
*/
export const telegramGroups = mysqlTable("telegram_groups", {
  id:       serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  /** Идентификатор чата в Telegram. У групп он отрицательный. */
  chatId:   varchar("chat_id", { length: 40 }).notNull(),
  /** Название чата на момент связывания — чтобы директор узнал его в списке. */
  title:    varchar("title", { length: 200 }),
  /** Кто связал: спрашивать «кто это сделал» приходится. */
  linkedBy: bigint("linked_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  /* Одна на организацию: повторное связывание заменяет прежнюю, и человеку
     об этом говорят прямо. */
  tenantUq: uniqueIndex("uq_tg_group_tenant").on(t.tenantId),
  chatIdx:  index("idx_tg_group_chat").on(t.chatId),
}));

export type TelegramGroup = typeof telegramGroups.$inferSelect;

export const apiExportLog = mysqlTable("api_export_log", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  /* Ключ может быть отозван позже — тогда здесь остаётся его номер, а самой
     строки ключа уже нет. Поэтому без внешнего ключа. */
  apiKeyId:    bigint("api_key_id", { mode: "number", unsigned: true }),
  endpoint:    varchar("endpoint", { length: 64 }).notNull(),
  /** snapshot или changes — режим, в котором пришли. */
  mode:        varchar("mode", { length: 16 }).notNull(),
  /** Точка возобновления, с которой пришли и которую отдали. */
  cursorIn:    varchar("cursor_in", { length: 512 }),
  cursorOut:   varchar("cursor_out", { length: 512 }),
  httpStatus:  int("http_status").notNull(),
  /** Строк в ответе. У отказа — ноль. */
  rows:        int("rows").default(0).notNull(),
  /** Числа сверки того же ответа: по ним разбирают спор о пропаже. */
  totalCount:  int("total_count"),
  amountTotal: decimal("amount_total", { precision: 14, scale: 2 }),
  durationMs:  int("duration_ms").default(0).notNull(),
  /** Текст отказа — короткий и без ключа: ключи в журнал не попадают. */
  error:       varchar("error", { length: 300 }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_export_log_tenant").on(t.tenantId, t.createdAt),
  keyIdx:    index("idx_export_log_key").on(t.apiKeyId, t.createdAt),
}));

export type ApiExportLog = typeof apiExportLog.$inferSelect;

// ============================================
// 1C CONFIG — per-tenant 1C Bridge connection settings
// ============================================
export const onecConfig = mysqlTable("onec_config", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  url:           varchar("url", { length: 500 }).notNull(),
  username:      varchar("username", { length: 100 }).notNull(),
  password:      varchar("password", { length: 500 }).notNull(),
  syncProducts:  boolean("sync_products").default(true),
  syncOrders:    boolean("sync_orders").default(true),
  intervalMinutes: int("interval_minutes").default(60),
  lastTestedAt:  timestamp("last_tested_at"),
  lastTestOk:    boolean("last_test_ok"),
  /**
   * SHA-256 секрета вебхука этой организации, в hex.
   *
   * Вебхук 1С проверялся ОДНИМ секретом на всю платформу, а организацию брал из
   * тела запроса. Любой, у кого этот секрет есть — а есть он у каждого клиента с
   * интеграцией и у его подрядчика, — мог прислать чужой tenantId и погасить
   * долг чужого магазина или переписать чужие остатки. В коде это признавалось
   * строкой `TODO: Replace global secret with per-tenant webhook secret`.
   *
   * Хранится хеш, а не сам секрет: как у ключей публичного API. Поиск идёт по
   * хешу, и организация берётся из найденной строки — тело запроса перестаёт
   * быть источником доверия.
   */
  webhookSecretHash: varchar("webhook_secret_hash", { length: 64 }),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: uniqueIndex("uq_onec_config_tenant").on(t.tenantId),
  webhookSecretUq: uniqueIndex("uq_onec_webhook_secret").on(t.webhookSecretHash),
}));

export type OneCConfig       = typeof onecConfig.$inferSelect;
export type InsertOneCConfig = typeof onecConfig.$inferInsert;

// ============================================
// LOADING LISTS — загрузочные листы для кладовщика
// ============================================
export const loadingLists = mysqlTable("loading_lists", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  listNumber:   varchar("list_number", { length: 50 }).notNull(),
  warehouseId:  bigint("warehouse_id", { mode: "number", unsigned: true }).references(() => warehouses.id, { onDelete: "set null" }),
  agentId:      bigint("agent_id", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  /*
    Кто повезёт этот лист.

    Погрузочный лист — это и есть рейс: заказы, собранные вместе, чтобы их
    отвёз один человек. Курьер при этом назначался НЕ на лист, а на каждый
    заказ по отдельности — по одному, из карточки или галочками в списке.
    Собрать лист из двадцати заказов и потом двадцать раз указать одного и того
    же курьера — работа ни для кого.

    Здесь связь заводится там, где она есть на самом деле. Заказам courier_id
    проставляется тем же действием: они и остаются источником правды для
    показателей и зарплаты, но заполняются одним движением.
  */
  courierId:    bigint("courier_id", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "restrict" }),
  routeData:    json("route_data"),
  status:       mysqlEnum("status", ["preparing", "ready", "loading", "loaded", "delivered"]).default("preparing").notNull(),
  totalOrders:  int("total_orders").default(0).notNull(),
  totalItems:   int("total_items").default(0).notNull(),
  totalWeight:  decimal("total_weight", { precision: 10, scale: 3 }),
  createdBy:    bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  loadedAt:     timestamp("loaded_at"),
  deliveredAt:  timestamp("delivered_at"),
}, (t) => ({
  listNumPerTenant: uniqueIndex("uq_list_number_tenant").on(t.listNumber, t.tenantId),
  tenantStatusIdx:  index("idx_lists_tenant_status").on(t.tenantId, t.status),
  agentIdx:         index("idx_lists_agent").on(t.agentId),
}));

export type LoadingList       = typeof loadingLists.$inferSelect;
export type InsertLoadingList = typeof loadingLists.$inferInsert;

// ============================================
// LOADING LIST ORDERS — состав загрузочного листа
// ============================================
export const loadingListOrders = mysqlTable("loading_list_orders", {
  listId:  bigint("list_id", { mode: "number", unsigned: true }).notNull().references(() => loadingLists.id, { onDelete: "cascade" }),
  orderId: bigint("order_id", { mode: "number", unsigned: true }).notNull().references(() => orders.id, { onDelete: "cascade" }),
}, (t) => ({
  pk:       primaryKey({ columns: [t.listId, t.orderId] }),
  orderIdx: index("idx_llo_order").on(t.orderId),
}));

export type LoadingListOrder       = typeof loadingListOrders.$inferSelect;
export type InsertLoadingListOrder = typeof loadingListOrders.$inferInsert;

// ============================================
// SAVED FILTERS — сохранённые наборы фильтров (заказы и т.п.)
// ============================================
export const savedFilters = mysqlTable("saved_filters", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  userId:       bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "cascade" }),
  name:         varchar("name", { length: 100 }).notNull(),
  filterConfig: json("filter_config").notNull(),
  isDefault:    boolean("is_default").default(false).notNull(),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_filters_user").on(t.userId),
}));

export type SavedFilter       = typeof savedFilters.$inferSelect;
export type InsertSavedFilter = typeof savedFilters.$inferInsert;

// ============================================
// ORDER COMMENTS — комментарии к заказам (threaded)
// ============================================
export const orderComments = mysqlTable("order_comments", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  orderId:   bigint("order_id", { mode: "number", unsigned: true }).notNull().references(() => orders.id, { onDelete: "cascade" }),
  userId:    bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  content:   text("content").notNull(),
  parentId:  bigint("parent_id", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orderIdx: index("idx_comments_order").on(t.orderId, t.createdAt),
}));

export type OrderComment       = typeof orderComments.$inferSelect;
export type InsertOrderComment = typeof orderComments.$inferInsert;

// ============================================
// DEBT REMINDERS — напоминания о долгах
// ============================================
export const debtReminders = mysqlTable("debt_reminders", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  shopId:    bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id, { onDelete: "restrict" }),
  orderId:   bigint("order_id", { mode: "number", unsigned: true }).references(() => orders.id, { onDelete: "set null" }),
  amount:    decimal("amount", { precision: 15, scale: 2 }).notNull(),
  dueDate:   date("due_date").notNull(),
  sentAt:    timestamp("sent_at"),
  paidAt:    timestamp("paid_at"),
  status:    mysqlEnum("status", ["pending", "sent", "paid", "overdue"]).default("pending").notNull(),
  reminderCount: int("reminder_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx:  index("idx_reminders_tenant").on(t.tenantId, t.status),
  shopIdx:    index("idx_reminders_shop").on(t.shopId, t.status),
  dueDateIdx: index("idx_reminders_due").on(t.dueDate, t.status),
}));

export type DebtReminder       = typeof debtReminders.$inferSelect;
export type InsertDebtReminder = typeof debtReminders.$inferInsert;

// ============================================
// ORDER ADJUSTMENTS — история корректировок
// ============================================
export const orderAdjustments = mysqlTable("order_adjustments", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  orderId:     bigint("order_id", { mode: "number", unsigned: true }).notNull().references(() => orders.id, { onDelete: "cascade" }),
  adjustedBy:  bigint("adjusted_by", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  type:        mysqlEnum("type", ["partial_delivery", "partial_payment", "price_change", "quantity_change"]).notNull(),
  oldValue:    json("old_value").notNull(),
  newValue:    json("new_value").notNull(),
  reason:      text("reason"),
  photos:      json("photos").$type<string[]>(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orderIdx:  index("idx_adjustments_order").on(t.orderId),
  tenantIdx: index("idx_adjustments_tenant").on(t.tenantId, t.createdAt),
}));

export type OrderAdjustment       = typeof orderAdjustments.$inferSelect;
export type InsertOrderAdjustment = typeof orderAdjustments.$inferInsert;

// ============================================
// LEADS — заявки с лендинга
// ============================================
//
// Отдельно от tenants: заявку оставляет тот, у кого организации ещё нет.
// Поэтому нет tenantId и нет внешних ключей — это вход в воронку, а не
// часть учёта.
//
// Заявка ХРАНИТСЯ, а уже потом отправляется уведомление. Форма, которая
// только шлёт сообщение в телеграм, теряет обращение молча, когда бот
// отключён или токен просрочен: человек видит «спасибо», а не доходит
// никуда. Здесь наоборот — уведомление может не уйти, запись останется.
export const leads = mysqlTable("leads", {
  id:        serial("id").primaryKey(),
  name:      varchar("name", { length: 120 }).notNull(),
  company:   varchar("company", { length: 200 }),
  phone:     varchar("phone", { length: 32 }).notNull(),
  comment:   text("comment"),
  // Откуда пришёл: раздел лендинга, с которого отправили форму.
  source:    varchar("source", { length: 64 }),
  // Ушло ли уведомление. false означает «заявка есть, но её не увидели» —
  // по этому полю их можно найти и разобрать вручную.
  notified:  boolean("notified").default(false).notNull(),
  // Обработана ли: чтобы список заявок не приходилось вести в голове.
  handledAt: timestamp("handled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  createdIdx:  index("idx_leads_created").on(t.createdAt),
  notifiedIdx: index("idx_leads_notified").on(t.notified),
}));

export type Lead       = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/* ═══════════════════════════════════════════════════════════════════════════
   Чат поддержки — только для тарифа Exclusive.

   ── Зачем ───────────────────────────────────────────────────────────────────

   «24/7 поддержка» стоит в списке возможностей тарифа на экране оплаты и до
   сих пор не была подкреплена ничем: организация платила за прямую линию, а
   написать могла только на общий адрес почты. Это та же беда, что была с
   телефоном поддержки, который сохранялся в настройках и не показывался ни на
   одном экране, — обещание без исполнения.

   ── Почему разговор у каждого свой ──────────────────────────────────────────

   Ключ разговора — пара (организация, пользователь), а не одна организация.
   Общий на всех тред означал бы, что агент читает переписку директора о
   деньгах и доступах. Отдельной таблицы тредов при этом нет: пара полей и есть
   тред, а лишняя таблица потребовала бы держать её в согласии с сообщениями.
   ═══════════════════════════════════════════════════════════════════════════ */
export const supportMessages = mysqlTable("support_messages", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  /** Чей это разговор. Платформа отвечает именно этому человеку. */
  userId:    bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  /** Сторона: false — написал пользователь, true — платформа. */
  fromPlatform: boolean("from_platform").default(false).notNull(),
  /*
    Кто именно написал. У ответа платформы это суперадмин, и его может не
    стать — поэтому связь снимается в null, а не запрещает удаление: переписка
    обязана пережить увольнение сотрудника поддержки.
  */
  authorId:  bigint("author_id", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  body:      varchar("body", { length: 4000 }).notNull(),
  /** Когда сообщение прочла ПРОТИВОПОЛОЖНАЯ сторона. */
  readAt:    timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  threadIdx: index("idx_support_thread").on(t.tenantId, t.userId, t.createdAt),
  // Непрочитанное считается с двух сторон, поэтому сторона входит в ключ.
  unreadIdx: index("idx_support_unread").on(t.userId, t.fromPlatform, t.readAt),
}));

export type SupportMessage       = typeof supportMessages.$inferSelect;
export type InsertSupportMessage = typeof supportMessages.$inferInsert;

/* ═══════════════════════════════════════════════════════════════════════════
   Разговор с поддержкой как отдельная сущность.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Переписка не должна лежать у нас вечно: решение владельца — после завершения
   разговора сообщения стираются. Но завершать было нечего. «Разговор» до сих
   пор существовал только как набор строк support_messages с одинаковой парой
   (организация, человек) — у него не было ни начала, ни конца, ни состояния.

   ── Почему строка на РАЗГОВОР, а не на пару ────────────────────────────────

   Один и тот же человек обращается много раз. Держи мы одну строку на пару,
   при новом вопросе пришлось бы затирать сведения о предыдущем — то есть ровно
   тот след, ради которого строка и остаётся после стирания текстов.

   ── Как сообщения относятся к разговору ─────────────────────────────────────

   По времени, а не по внешнему ключу: сообщения разговора — это сообщения той
   же пары между opened_at и closed_at. Ключ здесь ничего бы не добавил (новый
   разговор начинается строго после закрытия предыдущего), зато потребовал бы
   переписать существующие строки и все запросы к ним.

   ── Что остаётся после стирания ────────────────────────────────────────────

   Сама строка: чей разговор, когда шёл, сколько было сообщений. Тексты
   удаляются, счёт обращений платформа не теряет.
   ═══════════════════════════════════════════════════════════════════════════ */
export const supportThreads = mysqlTable("support_threads", {
  id:       serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  userId:   bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id, { onDelete: "restrict" }),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  /** Пусто — разговор идёт. */
  closedAt: timestamp("closed_at"),
  /*
    Кто завершил. «silence» — никто: разговор закрылся сам после двух недель
    молчания. Различать важно: закрытый по молчанию мог просто остаться без
    внимания, и это другой разговор с точки зрения качества поддержки, чем
    закрытый человеком.
  */
  closedBy: mysqlEnum("closed_by", ["client", "platform", "silence"]),
  /** Когда стёрты тексты. Пусто — сообщения ещё на месте. */
  purgedAt: timestamp("purged_at"),
  /** Сколько сообщений было. Заполняется в момент стирания. */
  messageCount: int("message_count").default(0).notNull(),
}, (t) => ({
  // Открытый разговор пары ищется на каждое сообщение — это самый частый запрос.
  pairIdx: index("idx_support_thread_pair").on(t.tenantId, t.userId, t.openedAt),
  // Что пора стирать: закрытые и ещё не стёртые.
  dueIdx:  index("idx_support_thread_due").on(t.purgedAt, t.closedAt),
}));

export type SupportThread       = typeof supportThreads.$inferSelect;
export type InsertSupportThread = typeof supportThreads.$inferInsert;

/* ═══════════════════════════════════════════════════════════════════════════
   Телеграм-бот: кому что слать и что не ушло.

   ── Правила ─────────────────────────────────────────────────────────────────

   Таблица правил — это ПЕРЕОПРЕДЕЛЕНИЯ поверх встроенных умолчаний, а не
   единственный источник. Разница существенная: если считать источником только
   её, у новой организации не будет ни одной строки — и уведомления окажутся
   выключены ровно там, где их никто не выключал. Ровно так в этом проекте уже
   умирали возможности: телефон поддержки сохранялся и не показывался,
   notifyUserById не вызывался ниоткуда, вебхук бота не был подключён.

   Поэтому пусто значит «как задумано», а строка появляется только тогда, когда
   директор что-то ИЗМЕНИЛ.

   ── Очередь ─────────────────────────────────────────────────────────────────

   Ночью уведомления не шлются, а копятся: склад закрыт, а телефон у человека
   рядом с подушкой. Копить их в памяти нельзя — выкладка происходит каждый
   день, и всё накопленное пропало бы молча.
   ═══════════════════════════════════════════════════════════════════════════ */
export const telegramRules = mysqlTable("telegram_rules", {
  id:       serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  event:    mysqlEnum("event", ["order.created", "stock.low", "debt.overdue", "delivery.assigned"]).notNull(),
  role:     mysqlEnum("role", ["ceo", "operator", "supervisor", "agent", "merchandiser", "courier"]).notNull(),
  enabled:  boolean("enabled").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  ruleIdx: uniqueIndex("uq_tg_rule").on(t.tenantId, t.event, t.role),
}));

export const telegramOutbox = mysqlTable("telegram_outbox", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  chatId:    varchar("chat_id", { length: 50 }).notNull(),
  body:      varchar("body", { length: 3000 }).notNull(),
  /** Раньше этого времени не отправлять — конец тихих часов. */
  sendAfter: timestamp("send_after").notNull(),
  sentAt:    timestamp("sent_at"),
  /** Сколько раз пытались. Вечно повторять нельзя: чат могли удалить. */
  attempts:  int("attempts").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  dueIdx: index("idx_tg_outbox_due").on(t.sentAt, t.sendAfter),
}));

export type TelegramRule   = typeof telegramRules.$inferSelect;
export type TelegramOutbox = typeof telegramOutbox.$inferSelect;

// ============================================
// ROLE PERMISSIONS — что арендатор отобрал у роли
// ============================================
/*
  Права ролей зашиты в middleware и одинаковы для всех организаций: оператор
  везде может удалить заказ, править товары и принимать оплату. Организации же
  устроены по-разному — в одной оператор это правая рука директора, в другой
  наёмный человек на телефоне, которому удалять заказы нельзя.

  Здесь лежат ТОЛЬКО отличия от зашитого умолчания: нет строки — можно, как и
  раньше. Поэтому выкладка ничего не меняет ни одному арендатору, а запрет
  всегда виден одной строкой в таблице, а не выводится из её отсутствия.

  Роль полем, хотя пока настраивается один оператор: следующей просьбой будет
  супервайзер, и она должна стоить строчку кода, а не миграцию боевой базы.
*/
export const rolePermissions = mysqlTable("role_permissions", {
  id:         serial("id").primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id, { onDelete: "restrict" }),
  role:       mysqlEnum("role", ["operator", "supervisor", "merchandiser", "courier", "agent"]).notNull(),
  /** Имя возможности из OPERATOR_CAPABILITIES, например «orders.delete». */
  capability: varchar("capability", { length: 64 }).notNull(),
  allowed:    boolean("allowed").notNull(),
  /** Кто менял — для журнала: право отобрали, а спросить некого. */
  updatedBy:  bigint("updated_by", { mode: "number", unsigned: true }).references(() => users.id, { onDelete: "set null" }),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  updatedAt:  timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx:   index("idx_role_permissions_tenant").on(t.tenantId),
  uniqueEntry: unique("uq_role_permission").on(t.tenantId, t.role, t.capability),
}));

export type RolePermission       = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = typeof rolePermissions.$inferInsert;

// ============================================
// CRON_RUNS — когда работа по расписанию удавалась в последний раз
// ============================================
/*
  Одна строка на работу, без арендатора: расписание — платформенное.

  Отметка нужна планировщику, чтобы догонять пропущенное: ежедневная работа,
  чей час прошёл, а удачи после него нет, выполняется при первой возможности,
  а не «завтра в ту же минуту». Память процесса для этого не годится —
  перезапуск и есть главный способ пропустить работу (см. api/cron/scheduler.ts).
*/
export const cronRuns = mysqlTable("cron_runs", {
  job:           varchar("job", { length: 64 }).primaryKey(),
  lastSuccessAt: timestamp("last_success_at"),
  lastErrorAt:   timestamp("last_error_at"),
  lastError:     text("last_error"),
});
