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

  // Leaf tables first, then parents
  await db.delete(schema.notifications);
  await db.delete(schema.dailyPlans);
  await db.delete(schema.payments);
  await db.delete(schema.arrivalItems);
  await db.delete(schema.arrivals);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.warehouseStock);
  await db.delete(schema.stockMovements);
  await db.delete(schema.shops);
  await db.delete(schema.products);
  await db.delete(schema.billingEvents);
  await db.delete(schema.invites);
  await db.delete(schema.subscriptions);
  await db.delete(schema.settings);
  await db.delete(schema.users);
  await db.delete(schema.tenants);

  console.log("✓ All tables cleared.");
  process.exit(0);
}

clear().catch((err) => {
  console.error("Clear failed:", err.message ?? err);
  process.exit(1);
});
