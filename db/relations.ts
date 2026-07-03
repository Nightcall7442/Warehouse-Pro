import { relations } from "drizzle-orm";
import {
  users,
  shops,
  products,
  orders,
  orderItems,
  warehouseStock,
  stockMovements,
  arrivals,
  arrivalItems,
  payments,
  agentLocations,
  dailyPlans,
  notifications,
  subscriptions,
  billingEvents,
  invites,
  tenants,
  tenantBranding,
  visitReports,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  assignedShops: many(shops),
  orders: many(orders),
  locations: many(agentLocations),
  dailyPlans: many(dailyPlans),
  notifications: many(notifications),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  agent: one(users, { fields: [shops.agentId], references: [users.id] }),
  orders: many(orders),
  payments: many(payments),
  dailyPlans: many(dailyPlans),
}));

export const productsRelations = relations(products, ({ many }) => ({
  orderItems: many(orderItems),
  warehouseStock: many(warehouseStock),
  stockMovements: many(stockMovements),
  arrivalItems: many(arrivalItems),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  shop: one(shops, { fields: [orders.shopId], references: [shops.id] }),
  agent: one(users, { fields: [orders.agentId], references: [users.id] }),
  courier: one(users, { fields: [orders.courierId], references: [users.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const warehouseStockRelations = relations(warehouseStock, ({ one }) => ({
  product: one(products, { fields: [warehouseStock.productId], references: [products.id] }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
}));

export const arrivalsRelations = relations(arrivals, ({ many }) => ({
  items: many(arrivalItems),
}));

export const arrivalItemsRelations = relations(arrivalItems, ({ one }) => ({
  arrival: one(arrivals, { fields: [arrivalItems.arrivalId], references: [arrivals.id] }),
  product: one(products, { fields: [arrivalItems.productId], references: [products.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  shop: one(shops, { fields: [payments.shopId], references: [shops.id] }),
}));

export const agentLocationsRelations = relations(agentLocations, ({ one }) => ({
  agent: one(users, { fields: [agentLocations.agentId], references: [users.id] }),
}));

export const dailyPlansRelations = relations(dailyPlans, ({ one }) => ({
  agent: one(users, { fields: [dailyPlans.agentId], references: [users.id] }),
  shop: one(shops, { fields: [dailyPlans.shopId], references: [shops.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

// ── Subscription relations ───────────────────────────────────────────────────
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  tenant: one(tenants, { fields: [subscriptions.tenantId], references: [tenants.id] }),
}));

export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
  tenant: one(tenants, { fields: [billingEvents.tenantId], references: [tenants.id] }),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  tenant:    one(tenants, { fields: [invites.tenantId],  references: [tenants.id] }),
  createdBy: one(users,   { fields: [invites.createdBy], references: [users.id]   }),
}));

export const tenantBrandingRelations = relations(tenantBranding, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantBranding.tenantId], references: [tenants.id] }),
}));

export const visitReportsRelations = relations(visitReports, ({ one }) => ({
  shop: one(shops, { fields: [visitReports.shopId], references: [shops.id] }),
  user: one(users, { fields: [visitReports.userId], references: [users.id] }),
  plan: one(dailyPlans, { fields: [visitReports.planId], references: [dailyPlans.id] }),
}));
