import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { firstRow, affectedRows } from "../lib/db-rows";
import type { Db } from "./order-shared";

/*
  Уход организации: стереть всё её из базы.

  ── Зачем ───────────────────────────────────────────────────────────────────

  Клиент ушёл — его заказы, магазины, сотрудники и GPS-следы агентов остаются
  в общей базе навсегда: ни одной ручки, которая бы их убирала, не было.
  Закон о персональных данных (ЗРУ-547) требует удалить данные, когда цель
  их обработки исчерпана, а бывший клиент вправе этого потребовать.

  ── Чем это отличается от «стереть всё» (no-mass-wipe) ──────────────────────

  Тот страж запрещает массовую очистку ВНУТРИ работающей организации: у
  оператора нет случая, ради которого стоило бы стирать историю продаж.
  Здесь организации больше нет — это действие платформы, не арендатора, и
  оно закрыто тремя замками: только суперадмин, только приостановленная
  организация, только с набранным slug и кодом второго фактора.

  ── Как ─────────────────────────────────────────────────────────────────────

  Ключи стоят с restrict (и это правильно — они и ловят ошибки в рабочих
  путях), поэтому таблицы стираются детьми вперёд, в одной транзакции:
  либо организация исчезает целиком, либо не трогается. Порядок — ниже,
  и он проверяется стражем по db/schema.ts: новая таблица с tenant_id, не
  попавшая в список, уронит тест, а не оставит сироту в бою.

  Таблицы без tenant_id (строки заказа, приходов, возвратов, токены сброса
  пароля) стираются через родителя: DELETE … JOIN parent WHERE parent.tenant_id.

  Резервные копии базы содержат данные до истечения своего срока хранения —
  это нормально и ожидается законом («разумный срок»); отдельно чистить
  копии не нужно.
*/

export type OffboardStep =
  | string
  | { table: string; via: { column: string; parent: string } };

/** Порядок удаления: дети раньше родителей. Последними — users и tenants. */
export const OFFBOARD_ORDER: readonly OffboardStep[] = [
  "agent_locations",
  "agent_territories",
  "api_export_log",
  "api_keys",
  { table: "arrival_items", via: { column: "arrival_id", parent: "arrivals" } },
  "audit_log",
  "billing_events",
  "commission_product_rates",
  "commissions",
  "debt_reminders",
  "id_mappings",
  "invites",
  { table: "loading_list_orders", via: { column: "list_id", parent: "loading_lists" } },
  "notifications",
  "onec_config",
  "order_adjustments",
  "order_comments",
  { table: "order_items", via: { column: "order_id", parent: "orders" } },
  { table: "password_reset_tokens", via: { column: "user_id", parent: "users" } },
  "payments",
  { table: "price_list_assignments", via: { column: "price_list_id", parent: "price_lists" } },
  { table: "price_list_items", via: { column: "price_list_id", parent: "price_lists" } },
  { table: "return_items", via: { column: "return_id", parent: "returns" } },
  "role_permissions",
  "salary_payouts",
  "sales_targets",
  "saved_filters",
  "settings",
  "stock_batches",
  { table: "stock_count_items", via: { column: "count_id", parent: "stock_counts" } },
  "stock_movements",
  "stock_transfers",
  "subscriptions",
  "supplier_payments",
  "support_messages",
  "support_threads",
  "telegram_groups",
  "telegram_outbox",
  "telegram_rules",
  "tenant_branding",
  "visit_reports",
  "visit_schedules",
  "warehouse_stock",
  "daily_plans",
  "loading_lists",
  "price_lists",
  "products",
  "returns",
  "stock_counts",
  "supplies",
  "arrivals",
  "orders",
  "suppliers",
  "warehouses",
  "shops",
  "territories",
  "users",
];

/** Платформенные таблицы без tenant_id — их уход организации не касается. */
export const NOT_TENANT_OWNED = ["tenants", "leads"] as const;

function stepTable(step: OffboardStep): string {
  return typeof step === "string" ? step : step.table;
}

/** Сколько строк по таблицам — для окна «что будет удалено» и для отчёта. */
export async function countTenantRows(db: Db, tenantId: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const step of OFFBOARD_ORDER) {
    const q = typeof step === "string"
      ? sql`SELECT COUNT(*) AS n FROM ${sql.identifier(step)} WHERE tenant_id = ${tenantId}`
      : sql`SELECT COUNT(*) AS n FROM ${sql.identifier(step.table)} t JOIN ${sql.identifier(step.via.parent)} p ON t.${sql.identifier(step.via.column)} = p.id WHERE p.tenant_id = ${tenantId}`;
    const n = Number(firstRow<{ n: unknown }>(await db.execute(q))?.n ?? 0);
    if (n > 0) out[stepTable(step)] = n;
  }
  return out;
}

export class TenantNotSuspendedError extends Error {
  constructor() { super("Сначала приостановите организацию — удалить можно только приостановленную"); }
}

/**
 * Стереть организацию целиком. Вызывающий обязан проверить статус, slug и
 * второй фактор — здесь только сама работа и её отчёт.
 */
export async function offboardTenant(db: Db, tenantId: number): Promise<{ deleted: Record<string, number>; total: number }> {
  const deleted: Record<string, number> = {};
  await db.transaction(async (tx) => {
    const status = firstRow<{ status: string }>(await tx.execute(sql`SELECT status FROM tenants WHERE id = ${tenantId} FOR UPDATE`))?.status;
    if (!status) throw new Error("Организация не найдена");
    if (status !== "suspended") throw new TenantNotSuspendedError();

    for (const step of OFFBOARD_ORDER) {
      const q = typeof step === "string"
        ? sql`DELETE FROM ${sql.identifier(step)} WHERE tenant_id = ${tenantId}`
        : sql`DELETE t FROM ${sql.identifier(step.table)} t JOIN ${sql.identifier(step.via.parent)} p ON t.${sql.identifier(step.via.column)} = p.id WHERE p.tenant_id = ${tenantId}`;
      const n = affectedRows(await tx.execute(q)) ?? 0;
      if (n > 0) deleted[stepTable(step)] = n;
    }
    const n = affectedRows(await tx.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}`));
    if (n !== 1) throw new Error("Организация не удалилась — откат");
  });
  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  logger.warn("tenant offboarded", { tenantId, total, deleted });
  return { deleted, total };
}
