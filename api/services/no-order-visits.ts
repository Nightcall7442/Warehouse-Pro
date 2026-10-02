/* ═══════════════════════════════════════════════════════════════════════════
   Визиты без заказа: что считать «без заказа» и отчёт директору.

   ── Что было ────────────────────────────────────────────────────────────────

   Агент отмечал визит, заказа не было — и директор не знал почему. Связи
   визита с заказом в базе нет вовсе: план визита (daily_plans) и заказ
   (orders) живут отдельно, и «конверсия» в KPI — это просто заказы,
   делённые на планы.

   ── Что считается визитом с заказом ─────────────────────────────────────────

   Визит «посещён», и в тот же день (по дате плана) ТОТ ЖЕ агент оформил
   заказ ТОМУ ЖЕ магазину — любой неудалённый, даже потом отменённый: агент
   свою работу сделал, а судьбу заказа решает офис. Дата заказа — created_at,
   как у выручки и комиссии (first_ordered_at нужен только старению долга).

   Правило одно и живёт здесь (visitHasOrderSql): его читают отметка визита
   (agent.getPlans → hasOrder: экран спрашивает причину, только когда заказа
   нет), отчёт ниже и светофор магазина (последняя причина). Записанная
   причина без этого правила ничего не значит: заказ, оформленный после
   отметки, перекрывает её — визит становится визитом с заказом.
   ═══════════════════════════════════════════════════════════════════════════ */
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  NO_ORDER_REASONS, NO_ORDER_STREAK_HINT, isNoOrderReason, noOrderInputError,
  type NoOrderReason,
} from "@contracts/no-order-reason";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/**
 * «У этого визита есть заказ» — условие SQL на строку daily_plans.
 *
 * Псевдоним плана — строкой, буквально: в подзапросе из orders ссылка
 * ${dailyPlans.shopId} у запроса из одной таблицы печатается без имени таблицы
 * и тихо становится orders.shop_id (memory: drizzle-correlated-subquery-trap).
 */
export function visitHasOrderSql(planAlias: "daily_plans" | "p"): SQL {
  const p = sql.raw(`\`${planAlias}\``);
  return sql`EXISTS (
    SELECT 1 FROM orders vo
    WHERE vo.tenant_id = ${p}.tenant_id
      AND vo.shop_id = ${p}.shop_id
      AND vo.agent_id = ${p}.agent_id
      AND vo.deleted_at IS NULL
      AND vo.created_at >= ${p}.plan_date
      AND vo.created_at < DATE_ADD(${p}.plan_date, INTERVAL 1 DAY)
  )`;
}

/**
 * Причина «без заказа» из входа ручки — проверенная и нормализованная.
 *
 * Поля необязательны: мобилка старой версии их не знает. Что они значат:
 *  • статус не «посещён» — причины нет (пропущенный визит не визит без заказа);
 *  • «Другое» без текста — отказ, текст длиннее столбца — отказ;
 *  • текст при другой причине не хранится — он пояснение к «Другое».
 */
export function noOrderFields(
  status: string,
  reason: NoOrderReason | null | undefined,
  note: string | null | undefined,
): { noOrderReason: NoOrderReason | null; noOrderNote: string | null } {
  if (status !== "visited" || !reason) return { noOrderReason: null, noOrderNote: null };
  const problem = noOrderInputError(reason, note);
  if (problem === "note_required") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Для причины «Другое» напишите коротко, что случилось." });
  }
  if (problem === "note_too_long") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Пояснение к причине слишком длинное (до 200 знаков)." });
  }
  return { noOrderReason: reason, noOrderNote: reason === "other" ? note!.trim() : null };
}

// ── Отчёт ──────────────────────────────────────────────────────────────────

/** Потолок строк визитов за отчёт: больше — значит период слишком длинный, и ответ это скажет. */
const ROW_CAP = 50_000;

export interface NoOrderFilter {
  from: string;
  to: string;
  agentId?: number;
  territoryId?: number;
}

type Reason = NoOrderReason | null;

interface VisitRow {
  id: number; shopId: number; agentId: number; day: string;
  reason: Reason; note: string | null; hasOrder: boolean;
  shopName: string; city: string | null; agentName: string | null;
}

export interface NoOrderReport {
  totals: { visits: number; withOrder: number; withoutOrder: number; share: number; unspecified: number };
  /** Разбивка визитов без заказа по причинам; доля — от визитов без заказа. null — «не указана». */
  byReason: Array<{ reason: Reason; count: number; share: number }>;
  byAgent: Array<{ agentId: number; agentName: string; visits: number; withoutOrder: number; share: number; topReason: Reason }>;
  byShop: Array<{
    shopId: number; shopName: string; city: string | null;
    visits: number; withoutOrder: number; share: number;
    /** Сколько раз подряд (с последнего визита) одна и та же причина; null — последний визит с заказом. */
    streak: { reason: Reason; count: number } | null;
    last: { reason: Reason; note: string | null; day: string } | null;
  }>;
  /** Магазины, где хоть раз «берёт у конкурента», — с числом раз и последним днём. */
  competitorShops: Array<{ shopId: number; shopName: string; city: string | null; count: number; lastDay: string; agentName: string | null }>;
  /** Магазины, где последние NO_ORDER_STREAK_HINT+ визитов подряд — «есть остаток»: заказ, видимо, великоват. */
  stockStreaks: Array<{ shopId: number; shopName: string; count: number }>;
  truncated: boolean;
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(result) ? result[0] : result;
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
}

/**
 * Отчёт «Визиты без заказа» за период — одним запросом, разбивки в памяти.
 *
 * Строк визитов за месяц у организации — тысячи, и все три разбивки (по
 * причинам, агентам, магазинам) плюс «сколько раз подряд» нужны из одних и
 * тех же строк: три GROUP BY разъехались бы между собой на первом же споре
 * о том, что считать визитом.
 */
export async function noOrderReport(db: Db, tenantId: number, f: NoOrderFilter): Promise<NoOrderReport> {
  const where: SQL[] = [
    sql`p.tenant_id = ${tenantId}`,
    sql`p.status = 'visited'`,
    sql`p.plan_date >= ${f.from}`,
    sql`p.plan_date <= ${f.to}`,
  ];
  if (f.agentId) where.push(sql`p.agent_id = ${f.agentId}`);
  if (f.territoryId) where.push(sql`s.territory_id = ${f.territoryId}`);

  const result = await db.execute(sql`
    SELECT p.id, p.shop_id AS shopId, p.agent_id AS agentId,
           DATE_FORMAT(p.plan_date, '%Y-%m-%d') AS day,
           p.no_order_reason AS reason, p.no_order_note AS note,
           ${visitHasOrderSql("p")} AS hasOrder,
           s.name AS shopName, s.city AS city, u.name AS agentName
    FROM daily_plans p
    JOIN shops s ON s.id = p.shop_id AND s.tenant_id = p.tenant_id
    LEFT JOIN users u ON u.id = p.agent_id AND u.tenant_id = p.tenant_id
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY p.plan_date DESC, p.id DESC
    LIMIT ${ROW_CAP + 1}
  `);
  const raw = rowsOf(result);
  const truncated = raw.length > ROW_CAP;
  const rows: VisitRow[] = raw.slice(0, ROW_CAP).map(r => ({
    id: Number(r.id), shopId: Number(r.shopId), agentId: Number(r.agentId), day: String(r.day),
    reason: isNoOrderReason(r.reason) ? r.reason : null,
    note: r.note == null ? null : String(r.note),
    hasOrder: Number(r.hasOrder) === 1,
    shopName: String(r.shopName ?? ""), city: r.city == null ? null : String(r.city),
    agentName: r.agentName == null ? null : String(r.agentName),
  }));

  const without = rows.filter(r => !r.hasOrder);
  const totals = {
    visits: rows.length,
    withOrder: rows.length - without.length,
    withoutOrder: without.length,
    share: share(without.length, rows.length),
    unspecified: without.filter(r => r.reason == null).length,
  };

  const reasonCount = new Map<Reason, number>();
  for (const r of without) reasonCount.set(r.reason, (reasonCount.get(r.reason) ?? 0) + 1);
  const byReason = [...NO_ORDER_REASONS, null].map(reason => ({
    reason, count: reasonCount.get(reason) ?? 0, share: share(reasonCount.get(reason) ?? 0, without.length),
  })).filter(x => x.count > 0).sort((a, b) => b.count - a.count);

  const topOf = (list: VisitRow[]): Reason => {
    const c = new Map<Reason, number>();
    for (const r of list) if (!r.hasOrder) c.set(r.reason, (c.get(r.reason) ?? 0) + 1);
    let best: Reason = null; let n = 0;
    for (const [k, v] of c) if (v > n || (v === n && best === null && k !== null)) { best = k; n = v; }
    return best;
  };

  const group = <K,>(key: (r: VisitRow) => K) => {
    const m = new Map<K, VisitRow[]>();
    for (const r of rows) { const k = key(r); const list = m.get(k); if (list) list.push(r); else m.set(k, [r]); }
    return m;
  };

  const byAgent = [...group(r => r.agentId)].map(([agentId, list]) => {
    const wo = list.filter(r => !r.hasOrder).length;
    return { agentId, agentName: list[0].agentName ?? `#${agentId}`, visits: list.length, withoutOrder: wo, share: share(wo, list.length), topReason: topOf(list) };
  }).sort((a, b) => b.withoutOrder - a.withoutOrder || b.share - a.share);

  const competitor = new Map<number, { shopId: number; shopName: string; city: string | null; count: number; lastDay: string; agentName: string | null }>();
  const stockStreaks: NoOrderReport["stockStreaks"] = [];

  const byShop = [...group(r => r.shopId)].map(([shopId, list]) => {
    // Строки уже по убыванию даты: первая — последний визит.
    const wo = list.filter(r => !r.hasOrder);
    let streak: { reason: Reason; count: number } | null = null;
    if (!list[0].hasOrder) {
      let count = 0;
      for (const r of list) { if (r.hasOrder || r.reason !== list[0].reason) break; count++; }
      streak = { reason: list[0].reason, count };
      if (list[0].reason === "has_stock" && count >= NO_ORDER_STREAK_HINT) {
        stockStreaks.push({ shopId, shopName: list[0].shopName, count });
      }
    }
    for (const r of wo) {
      if (r.reason !== "competitor") continue;
      const c = competitor.get(shopId);
      if (c) c.count++;
      else competitor.set(shopId, { shopId, shopName: r.shopName, city: r.city, count: 1, lastDay: r.day, agentName: r.agentName });
    }
    const lastWo = wo[0];
    return {
      shopId, shopName: list[0].shopName, city: list[0].city,
      visits: list.length, withoutOrder: wo.length, share: share(wo.length, list.length),
      streak,
      last: lastWo ? { reason: lastWo.reason, note: lastWo.note, day: lastWo.day } : null,
    };
  }).filter(s => s.withoutOrder > 0)
    .sort((a, b) => (b.streak?.count ?? 0) - (a.streak?.count ?? 0) || b.withoutOrder - a.withoutOrder);

  return {
    totals, byReason, byAgent, byShop,
    competitorShops: [...competitor.values()].sort((a, b) => b.count - a.count || b.lastDay.localeCompare(a.lastDay)),
    stockStreaks: stockStreaks.sort((a, b) => b.count - a.count),
    truncated,
  };
}

/**
 * Последняя причина «без заказа» по каждому магазину — для светофора.
 * Один запрос на любой список магазинов; визит, у которого потом появился
 * заказ, не считается.
 */
export async function lastNoOrderByShop(
  db: Db, tenantId: number, shopIds: number[],
): Promise<Map<number, { reason: string; note: string | null; date: string }>> {
  const out = new Map<number, { reason: string; note: string | null; date: string }>();
  if (shopIds.length === 0) return out;
  const result = await db.execute(sql`
    SELECT t.shopId, t.reason, t.note, t.day FROM (
      SELECT p.shop_id AS shopId, p.no_order_reason AS reason, p.no_order_note AS note,
             DATE_FORMAT(p.plan_date, '%Y-%m-%d') AS day,
             ROW_NUMBER() OVER (PARTITION BY p.shop_id ORDER BY p.plan_date DESC, p.id DESC) AS rn
      FROM daily_plans p
      WHERE p.tenant_id = ${tenantId}
        AND p.shop_id IN (${sql.join(shopIds.map(id => sql`${id}`), sql`, `)})
        AND p.status = 'visited' AND p.no_order_reason IS NOT NULL
        AND NOT ${visitHasOrderSql("p")}
    ) t WHERE t.rn = 1
  `);
  for (const r of rowsOf(result)) {
    out.set(Number(r.shopId), { reason: String(r.reason), note: r.note == null ? null : String(r.note), date: String(r.day) });
  }
  return out;
}
