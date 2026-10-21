/* ═══════════════════════════════════════════════════════════════════════════
   Отчёт «Недоставленные»: почему заказы не доехали.

   ── Что было ────────────────────────────────────────────────────────────────

   Срыв доставки снимал курьера с заказа и возвращал заказ в «новый» — и всё.
   Через неделю никто не мог сказать, сколько раз за месяц возили впустую,
   какой магазин закрыт к приезду курьера через раз и у какого курьера
   «не успел» стало привычкой.

   ── Откуда числа ────────────────────────────────────────────────────────────

   Из журнала попыток (delivery_events): одна строка — одна попытка, с
   курьером, причиной и временем. Срыв считается срывом (kind = failed),
   перенос — отдельно (kind = rescheduled): это разный разговор. Доставлено —
   с заказов (orders.delivered_at), как у KPI курьера, чтобы доля срывов в
   отчёте и в KPI считалась от одного и того же.

   Дни — по Ташкенту.
   ═══════════════════════════════════════════════════════════════════════════ */
import { sql, type SQL } from "drizzle-orm";
import { DELIVERY_FAIL_REASONS, isDeliveryFailReason, type DeliveryFailReason } from "@contracts/delivery-fail-reason";
import { dayEndUtc, dayStartUtc } from "../lib/date-range";
import { rowsOf } from "../lib/db-rows";
import type { Db } from "./order-shared";

/** Потолок строк журнала за отчёт: больше — период слишком длинный, и ответ это скажет. */
const ROW_CAP = 20_000;
/** Сколько последних попыток отдавать списком на экран. */
const RECENT = 200;

export interface FailedDeliveriesFilter {
  from: string; to: string; courierId?: number;
  /**
   * Все попытки периода, а не последние RECENT: для выгрузки в Excel. Файл
   * назван «за период», и обрезанный на двухсотой строке он молча расходился
   * с итогами по причинам и курьерам вверху того же отчёта.
   */
  allRows?: boolean;
}

type Reason = DeliveryFailReason | null;

interface EventRow {
  id: number; orderId: number; orderNumber: string; kind: "failed" | "rescheduled";
  courierId: number | null; courierName: string | null;
  shopId: number; shopName: string;
  reason: Reason; note: string | null; rescheduledTo: string | null; day: string; at: string;
}

export interface FailedDeliveriesReport {
  totals: { failed: number; rescheduled: number; orders: number; delivered: number; failShare: number; unspecified: number };
  /** Срывы по причинам; доля — от срывов. null — «не указана». */
  byReason: Array<{ reason: Reason; count: number; share: number }>;
  /** Курьеры: срывы, переносы, доставлено и доля срывов от попыток (доставлено + срывы). */
  byCourier: Array<{ courierId: number; courierName: string; failed: number; rescheduled: number; delivered: number; failShare: number; topReason: Reason }>;
  /** Магазины, куда не довезли хоть раз: сколько раз и последняя причина. */
  byShop: Array<{ shopId: number; shopName: string; failed: number; rescheduled: number; last: { reason: Reason; note: string | null; day: string } }>;
  recent: EventRow[];
  truncated: boolean;
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export async function failedDeliveriesReport(db: Db, tenantId: number, f: FailedDeliveriesFilter): Promise<FailedDeliveriesReport> {
  const from = dayStartUtc(f.from);
  const to = dayEndUtc(f.to);
  const where: SQL[] = [
    sql`e.tenant_id = ${tenantId}`,
    sql`e.kind IN ('failed', 'rescheduled')`,
    sql`e.recorded_at >= ${from}`,
    sql`e.recorded_at < ${to}`,
  ];
  if (f.courierId) where.push(sql`e.courier_id = ${f.courierId}`);

  const raw = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT e.id, e.order_id AS orderId, o.order_number AS orderNumber, e.kind,
           e.courier_id AS courierId, u.name AS courierName,
           o.shop_id AS shopId, s.name AS shopName,
           e.reason_code AS reason, e.note, DATE_FORMAT(e.rescheduled_to, '%Y-%m-%d') AS rescheduledTo,
           DATE_FORMAT(e.recorded_at + INTERVAL 5 HOUR, '%Y-%m-%d') AS day,
           DATE_FORMAT(e.recorded_at + INTERVAL 5 HOUR, '%Y-%m-%d %H:%i') AS at
    FROM delivery_events e
    JOIN orders o ON o.id = e.order_id AND o.tenant_id = e.tenant_id
    JOIN shops s ON s.id = o.shop_id AND s.tenant_id = e.tenant_id
    LEFT JOIN users u ON u.id = e.courier_id AND u.tenant_id = e.tenant_id
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY e.recorded_at DESC, e.id DESC
    LIMIT ${ROW_CAP + 1}
  `));
  const truncated = raw.length > ROW_CAP;
  const rows: EventRow[] = raw.slice(0, ROW_CAP).map(r => ({
    id: Number(r.id), orderId: Number(r.orderId), orderNumber: String(r.orderNumber ?? ""),
    kind: r.kind === "rescheduled" ? "rescheduled" : "failed",
    courierId: r.courierId == null ? null : Number(r.courierId),
    courierName: r.courierName == null ? null : String(r.courierName),
    shopId: Number(r.shopId), shopName: String(r.shopName ?? ""),
    reason: isDeliveryFailReason(r.reason) ? r.reason : null,
    note: r.note == null ? null : String(r.note),
    rescheduledTo: r.rescheduledTo == null ? null : String(r.rescheduledTo),
    day: String(r.day), at: String(r.at),
  }));

  // Доставлено за тот же период — тем же правилом, что «Доставлено» в KPI курьера.
  const deliveredRaw = rowsOf<Record<string, unknown>>(await db.execute(sql`
    SELECT o.courier_id AS courierId, u.name AS courierName, COUNT(*) AS n
    FROM orders o
    LEFT JOIN users u ON u.id = o.courier_id AND u.tenant_id = o.tenant_id
    WHERE o.tenant_id = ${tenantId}
      AND o.delivery_status = 'delivered'
      AND o.courier_id IS NOT NULL
      AND o.delivered_at >= ${from} AND o.delivered_at < ${to}
      ${f.courierId ? sql`AND o.courier_id = ${f.courierId}` : sql``}
    GROUP BY o.courier_id, u.name
  `));
  const deliveredBy = new Map(deliveredRaw.map(r => [Number(r.courierId), { n: Number(r.n), name: r.courierName == null ? null : String(r.courierName) }]));
  const deliveredTotal = [...deliveredBy.values()].reduce((s, d) => s + d.n, 0);

  const failed = rows.filter(r => r.kind === "failed");
  const rescheduled = rows.filter(r => r.kind === "rescheduled");

  const reasonCount = new Map<Reason, number>();
  for (const r of failed) reasonCount.set(r.reason, (reasonCount.get(r.reason) ?? 0) + 1);
  const byReason = [...DELIVERY_FAIL_REASONS, null].map(reason => ({
    reason, count: reasonCount.get(reason) ?? 0, share: share(reasonCount.get(reason) ?? 0, failed.length),
  })).filter(x => x.count > 0).sort((a, b) => b.count - a.count);

  const topOf = (list: EventRow[]): Reason => {
    const c = new Map<Reason, number>();
    for (const r of list) if (r.kind === "failed") c.set(r.reason, (c.get(r.reason) ?? 0) + 1);
    let best: Reason = null; let n = 0;
    for (const [k, v] of c) if (v > n) { best = k; n = v; }
    return best;
  };

  // Курьеры: и те, у кого срывы, и те, у кого только доставки, — доля видна у всех.
  const courierIds = new Set<number>([...deliveredBy.keys()]);
  for (const r of rows) if (r.courierId != null) courierIds.add(r.courierId);
  const byCourier = [...courierIds].map(courierId => {
    const list = rows.filter(r => r.courierId === courierId);
    const nFailed = list.filter(r => r.kind === "failed").length;
    const delivered = deliveredBy.get(courierId)?.n ?? 0;
    return {
      courierId,
      courierName: list[0]?.courierName ?? deliveredBy.get(courierId)?.name ?? `#${courierId}`,
      failed: nFailed,
      rescheduled: list.filter(r => r.kind === "rescheduled").length,
      delivered,
      failShare: share(nFailed, nFailed + delivered),
      topReason: topOf(list),
    };
  }).sort((a, b) => b.failed - a.failed || b.failShare - a.failShare);

  const shopsMap = new Map<number, EventRow[]>();
  for (const r of rows) { const l = shopsMap.get(r.shopId); if (l) l.push(r); else shopsMap.set(r.shopId, [r]); }
  const byShop = [...shopsMap].map(([shopId, list]) => ({
    shopId, shopName: list[0].shopName,
    failed: list.filter(r => r.kind === "failed").length,
    rescheduled: list.filter(r => r.kind === "rescheduled").length,
    // Строки уже по убыванию времени: первая — последняя попытка.
    last: { reason: list[0].reason, note: list[0].note, day: list[0].day },
  })).sort((a, b) => (b.failed + b.rescheduled) - (a.failed + a.rescheduled));

  return {
    totals: {
      failed: failed.length,
      rescheduled: rescheduled.length,
      orders: new Set(rows.map(r => r.orderId)).size,
      delivered: deliveredTotal,
      failShare: share(failed.length, failed.length + deliveredTotal),
      unspecified: failed.filter(r => r.reason == null).length,
    },
    byReason, byCourier, byShop,
    recent: f.allRows ? rows : rows.slice(0, RECENT),
    truncated,
  };
}
