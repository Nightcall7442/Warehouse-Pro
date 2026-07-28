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
  territories,
  visitSchedules,
  agentTerritories,
  returns,
  returnItems,
  warehouses,
  stockTransfers,
  salesTargets,
  commissions,
  priceLists,
  priceListItems,
  priceListAssignments,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  assignedShops: many(shops),
  orders: many(orders),
  locations: many(agentLocations),
  dailyPlans: many(dailyPlans),
  notifications: many(notifications),
  workZones: many(agentTerritories),
}));

export const shopsRelations = relations(shops, ({ one, many }) => ({
  agent: one(users, { fields: [shops.agentId], references: [users.id] }),
  territory: one(territories, { fields: [shops.territoryId], references: [territories.id] }),
  orders: many(orders),
  payments: many(payments),
  dailyPlans: many(dailyPlans),
}));

export const territoriesRelations = relations(territories, ({ many }) => ({
  shops: many(shops),
  agentLinks: many(agentTerritories),
}));

export const agentTerritoriesRelations = relations(agentTerritories, ({ one }) => ({
  agent: one(users, { fields: [agentTerritories.agentId], references: [users.id] }),
  territory: one(territories, { fields: [agentTerritories.territoryId], references: [territories.id] }),
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

export const visitSchedulesRelations = relations(visitSchedules, ({ one }) => ({
  agent: one(users, { fields: [visitSchedules.agentId], references: [users.id] }),
  shop: one(shops, { fields: [visitSchedules.shopId], references: [shops.id] }),
}));

export const returnsRelations = relations(returns, ({ one, many }) => ({
  shop: one(shops, { fields: [returns.shopId], references: [shops.id] }),
  agent: one(users, { fields: [returns.agentId], references: [users.id] }),
  order: one(orders, { fields: [returns.orderId], references: [orders.id] }),
  items: many(returnItems),
}));

export const returnItemsRelations = relations(returnItems, ({ one }) => ({
  return: one(returns, { fields: [returnItems.returnId], references: [returns.id] }),
  product: one(products, { fields: [returnItems.productId], references: [products.id] }),
}));

export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [warehouses.tenantId], references: [tenants.id] }),
  stock: many(warehouseStock),
}));

export const stockTransfersRelations = relations(stockTransfers, ({ one }) => ({
  tenant: one(tenants, { fields: [stockTransfers.tenantId], references: [tenants.id] }),
  product: one(products, { fields: [stockTransfers.productId], references: [products.id] }),
  fromWarehouse: one(warehouses, { fields: [stockTransfers.fromWarehouseId], references: [warehouses.id] }),
  toWarehouse: one(warehouses, { fields: [stockTransfers.toWarehouseId], references: [warehouses.id] }),
}));

export const salesTargetsRelations = relations(salesTargets, ({ one }) => ({
  user: one(users, { fields: [salesTargets.userId], references: [users.id] }),
  shop: one(shops, { fields: [salesTargets.shopId], references: [shops.id] }),
  territory: one(territories, { fields: [salesTargets.territoryId], references: [territories.id] }),
}));

export const commissionsRelations = relations(commissions, ({ one }) => ({
  user: one(users, { fields: [commissions.userId], references: [users.id] }),
}));

export const priceListsRelations = relations(priceLists, ({ many }) => ({
  items: many(priceListItems),
  assignments: many(priceListAssignments),
}));

export const priceListItemsRelations = relations(priceListItems, ({ one }) => ({
  priceList: one(priceLists, { fields: [priceListItems.priceListId], references: [priceLists.id] }),
  product: one(products, { fields: [priceListItems.productId], references: [products.id] }),
}));

export const priceListAssignmentsRelations = relations(priceListAssignments, ({ one }) => ({
  priceList: one(priceLists, { fields: [priceListAssignments.priceListId], references: [priceLists.id] }),
  shop: one(shops, { fields: [priceListAssignments.shopId], references: [shops.id] }),
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  shops: many(shops),
  products: many(products),
  orders: many(orders),
  warehouses: many(warehouses),
}));
