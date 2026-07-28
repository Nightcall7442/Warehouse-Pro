/**
 * Clears all data from the database in correct FK order.
 * Use for dev resets: npm run db:reset
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";

async function clear() {
  const db = getDb();
  console.log("🗑  Clearing all tables (FK-safe order)...");

  // Leaf tables first (deepest children), then parents
  // Level 4: items that reference other items
  await db.delete(schema.returnItems);
  await db.delete(schema.priceListItems);

  // Level 3: tables that reference orders/products/shops
  await db.delete(schema.notifications);
  await db.delete(schema.visitReports);
  await db.delete(schema.dailyPlans);
  await db.delete(schema.visitSchedules);
  await db.delete(schema.agentLocations);
  await db.delete(schema.payments);
  await db.delete(schema.arrivalItems);
  await db.delete(schema.arrivals);
  await db.delete(schema.orderItems);
  await db.delete(schema.returns);
  await db.delete(schema.commissions);
  await db.delete(schema.salesTargets);
  await db.delete(schema.priceListAssignments);

  // Level 2: orders, stock, transfers
  await db.delete(schema.orders);
  await db.delete(schema.stockTransfers);
  await db.delete(schema.warehouseStock);
  await db.delete(schema.stockMovements);

  // Level 1: main entities
  await db.delete(schema.shops);
  await db.delete(schema.products);
  await db.delete(schema.priceLists);
  await db.delete(schema.warehouses);
  await db.delete(schema.territories);

  // Level 0: tenant-level config
  await db.delete(schema.auditLog);
  await db.delete(schema.apiKeys);
  await db.delete(schema.onecConfig);
  await db.delete(schema.idMappings);
  await db.delete(schema.syncStatus);
  await db.delete(schema.billingEvents);
  await db.delete(schema.passwordResetTokens);
  await db.delete(schema.invites);
  await db.delete(schema.tenantBranding);
  await db.delete(schema.subscriptions);
  await db.delete(schema.settings);

  // Last: users and tenants
  await db.delete(schema.users);
  await db.delete(schema.tenants);

  console.log("✓ All tables cleared.");
  process.exit(0);
}

clear().catch((err) => {
  console.error("Clear failed:", err.message ?? err);
  process.exit(1);
});
