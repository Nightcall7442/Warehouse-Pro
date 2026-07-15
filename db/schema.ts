import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  decimal,
  boolean,
  date,
  time,
  int,
  json,
  uniqueIndex,
  index,
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
  maxUsers:      bigint("max_users", { mode: "number", unsigned: true }),
  maxProducts:   bigint("max_products", { mode: "number", unsigned: true }),
  maxOrdersMonth:bigint("max_orders_month", { mode: "number", unsigned: true }),
  // Contact
  ownerEmail:    varchar("owner_email", { length: 320 }),
  ownerPhone:    varchar("owner_phone", { length: 30 }),
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
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  name:         varchar("name", { length: 255 }).notNull(),
  email:        varchar("email", { length: 320 }).notNull(),
  passwordHash: varchar("password_hash", { length: 512 }).notNull(),
  avatar:       text("avatar"),
  phone:        varchar("phone", { length: 20 }),
  role:         mysqlEnum("role", ["superadmin", "ceo", "operator", "agent", "supervisor", "merchandiser", "courier"]).default("agent").notNull(),
  status:       mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt:     timestamp("lastSignInAt").defaultNow().notNull(),
  telegramChatId:   varchar("telegram_chat_id", { length: 50 }),
}, (t) => ({
  // email уникален внутри тенанта, но может повторяться в разных тенантах
  emailPerTenant: uniqueIndex("uq_user_email_tenant").on(t.email, t.tenantId),
  tenantIdx:      index("idx_users_tenant").on(t.tenantId),
}));

export type User       = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============================================
// SHOPS — торговые точки
// ============================================
export const shops = mysqlTable("shops", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  name:      varchar("name", { length: 255 }).notNull(),
  ownerName: varchar("owner_name", { length: 255 }),
  phone:     varchar("phone", { length: 20 }),
  address:   varchar("address", { length: 500 }),
  city:      varchar("city", { length: 100 }),
  district:  varchar("district", { length: 100 }),
  photoUrl:  text("photo_url"),
  gpsLat:    decimal("gps_lat", { precision: 10, scale: 8 }),
  gpsLng:    decimal("gps_lng", { precision: 11, scale: 8 }),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).references(() => users.id),
  debt:      decimal("debt", { precision: 12, scale: 2 }).default("0.00").notNull(),
  status:    mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  notes:     text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  tenantIdx: index("idx_shops_tenant").on(t.tenantId),
  cityIdx:   index("idx_shops_city").on(t.city),
  districtIdx: index("idx_shops_district").on(t.district),
  agentIdx:    index("idx_shops_agent").on(t.agentId),
  tenantStatusIdx: index("idx_shops_tenant_status").on(t.tenantId, t.status),
}));

export type Shop       = typeof shops.$inferSelect;
export type InsertShop = typeof shops.$inferInsert;

// ============================================
// PRODUCTS — товары
// ============================================
export const products = mysqlTable("products", {
  id:           serial("id").primaryKey(),
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  code:         varchar("code", { length: 50 }).notNull(),
  barcode:      varchar("barcode", { length: 100 }),
  name:         varchar("name", { length: 255 }).notNull(),
  category:     varchar("category", { length: 100 }),
  costPrice:    decimal("cost_price", { precision: 10, scale: 2 }).default("0.00").notNull(),
  unitPrice:    decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  unit:         mysqlEnum("unit", ["kg", "l", "pcs", "box", "pack", "m"]).default("pcs").notNull(),
  unitWeight:   decimal("unit_weight", { precision: 10, scale: 3 }).default("0.000").notNull(),
  description:  text("description"),
  photoUrl:     text("photo_url"),
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
// ORDERS — заказы
// ============================================
export const orders = mysqlTable("orders", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  orderNumber: varchar("order_number", { length: 50 }).notNull(),
  shopId:      bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id),
  agentId:     bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  status:      mysqlEnum("status", ["new", "processing", "completed", "cancelled"]).default("new").notNull(),
  subtotal:    decimal("subtotal", { precision: 12, scale: 2 }).default("0.00").notNull(),
  discount:    decimal("discount", { precision: 12, scale: 2 }).default("0.00").notNull(),
  total:       decimal("total", { precision: 12, scale: 2 }).default("0.00").notNull(),
  notes:       text("notes"),
  idempotencyKey: varchar("idempotency_key", { length: 64 }),
  courierId:   bigint("courier_id", { mode: "number", unsigned: true }).references(() => users.id),
  deliveryStatus: mysqlEnum("delivery_status", ["not_assigned", "assigned", "out_for_delivery", "delivered", "failed"]).default("not_assigned").notNull(),
  deliveredAt: timestamp("delivered_at"),
  deletedAt:   timestamp("deleted_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
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
  }));

export type Order       = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// ============================================
// ORDER ITEMS
// ============================================
export const orderItems = mysqlTable("order_items", {
  id:        serial("id").primaryKey(),
  orderId:   bigint("order_id", { mode: "number", unsigned: true }).notNull().references(() => orders.id),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  quantity:  decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  subtotal:  decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orderIdx: index("idx_order_items_order").on(t.orderId),
  productIdx: index("idx_order_items_product").on(t.productId),
}));

export type OrderItem       = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// ============================================
// WAREHOUSES (multi-warehouse support)
// ============================================
export const warehouses = mysqlTable("warehouses", {
  id:          serial("id").primaryKey(),
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
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
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  fromWarehouseId: bigint("from_warehouse_id", { mode: "number", unsigned: true }).notNull().references(() => warehouses.id),
  toWarehouseId:   bigint("to_warehouse_id", { mode: "number", unsigned: true }).notNull().references(() => warehouses.id),
  productId:     bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  quantity:      decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  status:        varchar("status", { length: 20 }).default("pending").notNull(),
  notes:         text("notes"),
  createdBy:     bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id),
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
  tenantId:     bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  warehouseId:  bigint("warehouse_id", { mode: "number", unsigned: true }).references(() => warehouses.id),
  productId:    bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  currentStock: decimal("current_stock", { precision: 12, scale: 2 }).default("0.00").notNull(),
  reserved:     decimal("reserved", { precision: 12, scale: 2 }).default("0.00").notNull(),
  available:    decimal("available", { precision: 12, scale: 2 }).default("0.00").notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => ({
  productPerTenant: uniqueIndex("uq_stock_product_tenant").on(t.productId, t.tenantId),
  tenantIdx:        index("idx_stock_tenant").on(t.tenantId),
  warehouseIdx:     index("idx_stock_warehouse").on(t.warehouseId),
}));

export type WarehouseStock       = typeof warehouseStock.$inferSelect;
export type InsertWarehouseStock = typeof warehouseStock.$inferInsert;

// ============================================
// STOCK MOVEMENTS
// ============================================
export const stockMovements = mysqlTable("stock_movements", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  productId:     bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  type:          mysqlEnum("type", ["in", "out", "adjustment"]).notNull(),
  quantity:      decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  referenceType: varchar("reference_type", { length: 50 }),
  referenceId:   bigint("reference_id", { mode: "number", unsigned: true }),
  notes:         text("notes"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_movements_tenant").on(t.tenantId),
  productIdx: index("idx_movements_product").on(t.productId),
  tenantProductIdx: index("idx_movements_tenant_product").on(t.tenantId, t.productId),
  tenantCreatedIdx: index("idx_movements_tenant_created").on(t.tenantId, t.createdAt),
}));

export type StockMovement       = typeof stockMovements.$inferSelect;
export type InsertStockMovement = typeof stockMovements.$inferInsert;

// ============================================
// ARRIVALS — приход фур
// ============================================
export const arrivals = mysqlTable("arrivals", {
  id:            serial("id").primaryKey(),
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
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
  id:        serial("id").primaryKey(),
  arrivalId: bigint("arrival_id", { mode: "number", unsigned: true }).notNull().references(() => arrivals.id),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull().references(() => products.id),
  quantity:  decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  condition: varchar("condition", { length: 255 }),
  notes:     text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  arrivalIdx: index("idx_arrival_items_arrival").on(t.arrivalId),
  productIdx: index("idx_arrival_items_product").on(t.productId),
}));

export type ArrivalItem       = typeof arrivalItems.$inferSelect;
export type InsertArrivalItem = typeof arrivalItems.$inferInsert;

// ============================================
// PAYMENTS
// ============================================
export const payments = mysqlTable("payments", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  shopId:    bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id),
  amount:    decimal("amount", { precision: 12, scale: 2 }).notNull(),
  type:      mysqlEnum("type", ["payment", "debt"]).default("payment").notNull(),
  notes:     text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_payments_tenant").on(t.tenantId),
  shopIdx:   index("idx_payments_shop").on(t.shopId),
  tenantShopIdx: index("idx_payments_tenant_shop").on(t.tenantId, t.shopId),
  createdAtIdx:  index("idx_payments_created_at").on(t.createdAt),
}));

export type Payment       = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

// ============================================
// AGENT LOCATIONS — GPS трекинг
// ============================================
export const agentLocations = mysqlTable("agent_locations", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  lat:       decimal("lat", { precision: 10, scale: 8 }).notNull(),
  lng:       decimal("lng", { precision: 11, scale: 8 }).notNull(),
  accuracy:  decimal("accuracy", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index("idx_locations_tenant").on(t.tenantId),
  tenantAgentIdx: index("idx_locations_tenant_agent").on(t.tenantId, t.agentId),
  tenantCreatedIdx: index("idx_locations_tenant_created").on(t.tenantId, t.createdAt),
}));

export type AgentLocation       = typeof agentLocations.$inferSelect;
export type InsertAgentLocation = typeof agentLocations.$inferInsert;

// ============================================
// DAILY PLANS
// ============================================
export const dailyPlans = mysqlTable("daily_plans", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  agentId:   bigint("agent_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  shopId:    bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id),
  planDate:  date("plan_date").notNull(),
  status:    mysqlEnum("status", ["planned", "visited", "skipped"]).default("planned").notNull(),
  notes:     text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).references(() => users.id),
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
// NOTIFICATIONS
// ============================================
export const notifications = mysqlTable("notifications", {
  id:        serial("id").primaryKey(),
  tenantId:  bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  userId:    bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
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
}));

export type Notification       = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ============================================
// SETTINGS — настройки компании (1 строка на тенант)
// ============================================
export const settings = mysqlTable("settings", {
  id:                  serial("id").primaryKey(),
  tenantId:            bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id).unique(),
  companyName:         varchar("company_name", { length: 255 }).default("Warehouse Pro").notNull(),
  currency:            varchar("currency", { length: 10 }).default("UZS").notNull(),
  currencySymbol:      varchar("currency_symbol", { length: 10 }).default("сум").notNull(),
  defaultReorderPoint: decimal("default_reorder_point", { precision: 10, scale: 2 }).default("0.00").notNull(),
  lowStockThreshold:   decimal("low_stock_threshold", { precision: 10, scale: 2 }).default("50.00").notNull(),
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
  tenantId:             bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id).unique(),
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
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).references(() => tenants.id),
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
  tenantId:   bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  email:      varchar("email", { length: 320 }).notNull(),
  role:       mysqlEnum("role", ["operator", "agent", "supervisor", "merchandiser", "courier"]).notNull(),
  token:      varchar("token", { length: 64 }).notNull().unique(),
  expiresAt:  timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdBy:  bigint("created_by", { mode: "number", unsigned: true }).notNull().references(() => users.id),
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
  tenantId:      bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id).unique(),
  logoUrl:       text("logo_url"),
  primaryColor:  varchar("primary_color", { length: 7 }).default("#2563eb"),
  secondaryColor:varchar("secondary_color", { length: 7 }).default("#1e40af"),
  accentColor:   varchar("accent_color", { length: 7 }).default("#3b82f6"),
  companyName:   varchar("company_name", { length: 255 }),
  appName:       varchar("app_name", { length: 255 }).default("Warehouse Pro"),
  supportEmail:  varchar("support_email", { length: 320 }),
  supportPhone:  varchar("support_phone", { length: 50 }),
  // White-label extensions
  customDomain:  varchar("custom_domain", { length: 255 }),
  faviconUrl:    varchar("favicon_url", { length: 500 }),
  loginTitle:    varchar("login_title", { length: 100 }),
  loginSubtitle: varchar("login_subtitle", { length: 255 }),
  footerText:    varchar("footer_text", { length: 500 }),
  mobileTheme:   varchar("mobile_theme", { length: 10 }).default("auto"),
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
  tenantId:       bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  shopId:         bigint("shop_id", { mode: "number", unsigned: true }).notNull().references(() => shops.id),
  userId:         bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
  planId:         bigint("plan_id", { mode: "number", unsigned: true }).notNull().references(() => dailyPlans.id),
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
}));

export type VisitReport       = typeof visitReports.$inferSelect;
export type InsertVisitReport = typeof visitReports.$inferInsert;

// ============================================
// AUDIT LOG — журнал чувствительных действий
// ============================================
export const auditLog = mysqlTable("audit_log", {
  id:         serial("id").primaryKey(),
  tenantId:   bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
  actorId:    bigint("actor_id", { mode: "number", unsigned: true }).references(() => users.id),
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
  userId:    bigint("user_id", { mode: "number", unsigned: true }).notNull().references(() => users.id),
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
  tenantId:    bigint("tenant_id", { mode: "number", unsigned: true }).notNull().references(() => tenants.id),
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
