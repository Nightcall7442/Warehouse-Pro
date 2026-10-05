import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { tenants, users, warehouses, products, warehouseStock, apiKeys, orders, payments, shops, dailyPlans, salesTargets } from "@db/schema";
import { receiveStock } from "./stock-ledger";
import { recalcShopDebt } from "./shop-debt";

type Db = ReturnType<typeof import("../queries/connection").getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Демо-вход для жюри (Pitch Day 3.0, страница /demo).

   ── Что это ─────────────────────────────────────────────────────────────────

   Кнопки «Direktor sifatida kirish» / «Agent sifatida kirish» на /demo
   открывают обычную сессию в ПЕСОЧНИЦЕ — организации с выдуманными данными
   (services/sandbox.ts). Пароль нигде не публикуется: сервер сам выбирает
   человека нужной роли в этой организации и выдаёт ему сессию.

   ── Три условия, без любого из которых входа нет ────────────────────────────

   1. Переменная PITCH_DEMO_TENANT_ID задана. Не задана — демо выключено, и
      /api/demo/login отвечает 404, как будто его нет.
   2. Организация с этим номером ПОМЕЧЕНА ПЕСОЧНИЦЕЙ и активна. Опечатка в
      переменной, указавшая на живого арендатора, даёт отказ, а не чужую
      сессию: проверяется пометка в базе, а не слово человека.
   3. В ней есть активный пользователь нужной роли.

   ── Что демо-сессии нельзя ─────────────────────────────────────────────────

   Демо-сессия — это сессия ЛЮБОГО пользователя демо-организации: признак
   берётся из организации, а не из токена. Поэтому его не потерять при
   обновлении токена и не обойти перевыпуском: закрыто всё, что меняет
   учётную запись, людей, деньги платформы и интеграции. Работа с товаром,
   заказами, визитами и складом открыта — жюри пробует продукт, а не витрину.
   Список — в api/lib/pitch-demo-rules.ts, и стражу
   (api/__tests__/pitch-demo-guard.test.ts) он известен поимённо: новая
   мутация в закрытом пространстве закрывается сама.
   ═══════════════════════════════════════════════════════════════════════════ */

export {
  DEMO_ROLES, isDemoRole, pitchDemoTenantId, isDemoTenant,
  DEMO_BLOCKED_NAMESPACES, DEMO_BLOCKED_MUTATIONS, isBlockedForDemo, DEMO_BLOCKED_MESSAGE,
} from "../lib/pitch-demo-rules";
export type { DemoRole } from "../lib/pitch-demo-rules";
import { DEMO_ROLES, pitchDemoTenantId, isDemoTenant, type DemoRole } from "../lib/pitch-demo-rules";

export type DemoRefusal = "disabled" | "not_sandbox" | "no_user";

/** Чью сессию выдать для роли — или почему никого. */
export async function findDemoUser(db: Db, role: DemoRole): Promise<
  { ok: true; userId: number; tokenVersion: number } | { ok: false; reason: DemoRefusal }
> {
  const tenantId = pitchDemoTenantId();
  if (tenantId === null) return { ok: false, reason: "disabled" };

  const [tenant] = await db.select({ id: tenants.id, isSandbox: tenants.isSandbox, status: tenants.status })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant || tenant.isSandbox !== true || tenant.status !== "active") return { ok: false, reason: "not_sandbox" };

  const [user] = await db.select({ id: users.id, tokenVersion: users.tokenVersion })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, role), eq(users.status, "active")))
    .orderBy(asc(users.id))
    .limit(1);
  if (!user) return { ok: false, reason: "no_user" };
  return { ok: true, userId: Number(user.id), tokenVersion: user.tokenVersion ?? 0 };
}

/** Пользователь из демо-организации? Для HTTP-путей вне tRPC (logout-all). */
export async function isDemoUser(db: Db, userId: number): Promise<boolean> {
  const tenantId = pitchDemoTenantId();
  if (tenantId === null) return false;
  const [row] = await db.select({ tenantId: users.tenantId, isSandbox: tenants.isSandbox })
    .from(users).innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.id, userId)).limit(1);
  return !!row && isDemoTenant({ id: Number(row.tenantId), isSandbox: row.isSandbox });
}

export interface DemoStatus {
  enabled: boolean;
  /** Роли, для которых в демо-организации есть кого впустить. */
  roles: DemoRole[];
  /** Ключ API только для чтения — если он настроен и принадлежит именно демо-песочнице. */
  apiKey: string | null;
}

/**
 * Что показать на /demo и /pitch: включено ли, какие кнопки, есть ли ключ.
 *
 * Ключ (PITCH_DEMO_API_KEY) отдаётся наружу, только если он проверен по базе:
 * его отпечаток есть, он живой, не просрочен, принадлежит демо-песочнице и
 * начинается с wp_test_. Публичный API весь только на чтение
 * (api/public-api.ts отвечает 405 на любой метод, кроме GET/HEAD), так что
 * этим ключом можно лишь читать выдуманные данные песочницы. Ключ живого
 * арендатора, по ошибке вписанный в переменную, не уйдёт на страницу.
 */
export async function demoStatus(db: Db): Promise<DemoStatus> {
  const off: DemoStatus = { enabled: false, roles: [], apiKey: null };
  const tenantId = pitchDemoTenantId();
  if (tenantId === null) return off;

  const [tenant] = await db.select({ id: tenants.id, isSandbox: tenants.isSandbox, status: tenants.status })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant || tenant.isSandbox !== true || tenant.status !== "active") return off;

  const rows = await db.select({ role: users.role })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.status, "active")))
    .groupBy(users.role);
  const present = new Set(rows.map(r => String(r.role)));
  const roles = DEMO_ROLES.filter(r => present.has(r));

  return { enabled: roles.length > 0, roles, apiKey: await verifiedDemoKey(db, tenantId) };
}

async function verifiedDemoKey(db: Db, tenantId: number): Promise<string | null> {
  const raw = process.env.PITCH_DEMO_API_KEY?.trim();
  if (!raw || !raw.startsWith("wp_test_")) return null;
  const keyHash = createHash("sha256").update(raw).digest("hex");
  const [key] = await db.select({ tenantId: apiKeys.tenantId, status: apiKeys.status, expiresAt: apiKeys.expiresAt })
    .from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
  if (!key || Number(key.tenantId) !== tenantId || key.status !== "active") return null;
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return null;
  return raw;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Досев песочницы для показа.

   Песочница интегратора намеренно без остатков и без супервайзера: выгрузке
   они не нужны (services/sandbox.ts). Жюри же пробует продукт руками — и
   первый же заказ упёрся бы в «на складе 0». Здесь добавляется ровно то,
   без чего показ не работает:

   - остаток каждого товара на основном складе — партиями со сроком, две из
     них близко к концу срока, чтобы было что увидеть на рабочем месте сроков;
   - себестоимость (74 % цены) у товаров и у строк заказов, иначе прибыль в
     отчётах равна выручке, а валовая прибыль на главной — 100 %;
   - оплаты доставленных заказов: наличные, карта и перевод — целиком, «в
     долг» — часть частично, часть нет. Без них долг магазинов либо ноль, либо
     вся выручка, и раздел долгов — главный довод продукта — пуст;
   - план визитов агентам на 45 дней вперёд — жюри смотрит не в день засева,
     и «Bugun tashrif yo'q» на главной агента ничего не показало бы;
   - один супервайзер — третья кнопка на /demo.

   Только песочница, и только пустое: остаток кладётся, если на складе ноль,
   супервайзер — если его нет. Повторный вызов ничего не удваивает.
   ═══════════════════════════════════════════════════════════════════════════ */
/**
 * Множители плана к темпу агента — по кругу, чтобы в прогнозе были все цвета:
 * план выше темпа (не дотягивает), чуть выше (чуть не дотягивает), ниже (выполнит).
 */
export const PITCH_PLAN_MULTIPLIERS = [1.25, 1.06, 1.05, 0.92] as const;

/** План на месяц из темпа: круглая сумма, как ставят люди; без продаж — скромный, не ноль. */
export function pitchPlanFor(monthlyRevenue: number, monthlyOrders: number, mult: number): { amount: number; orderCount: number } {
  return {
    amount: Math.max(5_000_000, Math.round((monthlyRevenue * mult) / 500_000) * 500_000),
    orderCount: Math.max(10, Math.round(monthlyOrders * mult)),
  };
}

export async function seedPitchDemoExtras(db: Db, tenantId: number, now: Date = new Date()) {
  const [tenant] = await db.select({ isSandbox: tenants.isSandbox })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Организация не найдена" });
  if (!tenant.isSandbox) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Это не песочница. Досевать демо можно только песочницу." });
  }

  let supervisorAdded = false;
  const [sup] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "supervisor"))).limit(1);
  if (!sup) {
    // Пароль непригоден («!» — не хеш): войти можно только кнопкой на /demo.
    await db.insert(users).values({
      tenantId, name: "Supervayzer (demo)", email: `supervisor1-t${tenantId}@sandbox.invalid`,
      passwordHash: "!", role: "supervisor", status: "active", lastSignInAt: now,
    });
    supervisorAdded = true;
  }

  await db.update(products)
    .set({ costPrice: sql`ROUND(${products.unitPrice} * 0.74, 2)` })
    .where(and(eq(products.tenantId, tenantId), sql`${products.costPrice} = 0`));
  await db.execute(sql`
    UPDATE order_items oi JOIN orders o ON o.id = oi.order_id
    SET oi.cost_price = ROUND(oi.unit_price * 0.74, 2)
    WHERE o.tenant_id = ${tenantId} AND (oi.cost_price IS NULL OR oi.cost_price = 0)
  `);

  let paymentsAdded = 0;
  const [{ paid }] = await db.select({ paid: sql<number>`COUNT(*)` }).from(payments).where(eq(payments.tenantId, tenantId));
  if (Number(paid) === 0) {
    const delivered = await db.select({
      id: orders.id, shopId: orders.shopId, total: orders.total, method: orders.paymentMethod, deliveredAt: orders.deliveredAt, createdAt: orders.createdAt,
    }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.status, "delivered"), isNull(orders.deletedAt)))
      .orderBy(asc(orders.id));
    const rows: Array<typeof payments.$inferInsert> = [];
    let debtIdx = 0;
    for (const o of delivered) {
      const at = o.deliveredAt ?? o.createdAt;
      const total = Number(o.total);
      if (o.method !== "debt") {
        rows.push({ tenantId, shopId: Number(o.shopId), orderId: Number(o.id), amount: total.toFixed(2), type: "payment",
          paymentMethod: o.method, status: "paid", totalOrderAmount: total.toFixed(2), paidAmount: total.toFixed(2), debtAmount: "0.00", paidAt: at, createdAt: at,
          // Безнал в демо уже подтверждён банком — иначе он висел бы «ждёт банка» у всех.
          bankConfirmedAt: o.method === "cash" ? null : at });
        continue;
      }
      // «В долг»: каждый третий принёс 40 %, остальные пока не платили.
      if (debtIdx++ % 3 === 0) {
        const part = Math.round(total * 0.4);
        const due = new Date(at.getTime() + 14 * 86_400_000);
        rows.push({ tenantId, shopId: Number(o.shopId), orderId: Number(o.id), amount: part.toFixed(2), type: "payment",
          paymentMethod: "cash", status: "partially_paid", totalOrderAmount: total.toFixed(2), paidAmount: part.toFixed(2),
          debtAmount: (total - part).toFixed(2), debtDueDate: due, paidAt: at, createdAt: at });
      }
    }
    const shopIds = [...new Set(delivered.map(o => Number(o.shopId)))];
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 100) await tx.insert(payments).values(rows.slice(i, i + 100));
      for (const shopId of shopIds) await recalcShopDebt(tx, tenantId, shopId);
    });
    paymentsAdded = rows.length;
  }

  const [{ onHand }] = await db.select({ onHand: sql<string>`COALESCE(SUM(${warehouseStock.currentStock}), 0)` })
    .from(warehouseStock).where(eq(warehouseStock.tenantId, tenantId));
  let stocked = 0;
  if (Number(onHand) === 0) {
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true))).limit(1);
    if (!wh) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "В песочнице нет основного склада." });
    const list = await db.select({ id: products.id, costPrice: products.costPrice })
      .from(products).where(eq(products.tenantId, tenantId)).orderBy(asc(products.id));
    const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    await db.transaction(async (tx) => {
      for (const [i, p] of list.entries()) {
        // Две первые позиции — с коротким сроком: рабочее место сроков не пустое.
        const expiresIn = i < 2 ? 6 + i * 3 : 60 + i * 15;
        await receiveStock(tx, {
          tenantId, warehouseId: Number(wh.id), productId: Number(p.id),
          quantity: 240 + i * 36, reason: "arrival", notes: "Демо-остаток для показа",
          batch: { batchNumber: `DEMO-${String(i + 1).padStart(2, "0")}`, expiresAt: day(expiresIn), costPrice: p.costPrice },
        });
        stocked++;
      }
    });
  }
  let plansAdded = 0;
  const [{ planned }] = await db.select({ planned: sql<number>`COUNT(*)` }).from(dailyPlans).where(eq(dailyPlans.tenantId, tenantId));
  if (Number(planned) === 0) {
    const assigned = await db.select({ id: shops.id, agentId: shops.agentId }).from(shops)
      .where(and(eq(shops.tenantId, tenantId), eq(shops.status, "active"))).orderBy(asc(shops.id));
    const byAgent = new Map<number, number[]>();
    for (const s of assigned) {
      if (s.agentId == null) continue;
      const list = byAgent.get(Number(s.agentId)) ?? [];
      list.push(Number(s.id));
      byAgent.set(Number(s.agentId), list);
    }
    const rows: Array<typeof dailyPlans.$inferInsert> = [];
    // Полдень по UTC: дата не съезжает на соседний день ни в одном поясе Узбекистана.
    const noon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
    for (let d = 0; d < 45; d++) {
      const planDate = new Date(noon + d * 86_400_000);
      for (const list of byAgent.values()) {
        const perDay = Math.min(5, list.length);
        for (let k = 0; k < perDay; k++) {
          rows.push({ tenantId, agentId: 0, shopId: list[(d * perDay + k) % list.length], planDate });
        }
      }
    }
    // agentId — по магазину (план ведёт тот, за кем магазин).
    const agentOf = new Map(assigned.map(s => [Number(s.id), Number(s.agentId)]));
    for (const r of rows) r.agentId = agentOf.get(r.shopId as number)!;
    for (let i = 0; i < rows.length; i += 200) await db.insert(dailyPlans).values(rows.slice(i, i + 200));
    plansAdded = rows.length;
  }

  /*
    Планы продаж на этот и следующий месяц.

    Без них «Прогноз плана» у директора и KPI у агента пишут «Reja yo'q» —
    жюри заходит агентом и видит пустой план (05.10.2026). План — от темпа
    самого агента за 90 дней доставленных заказов, с разным множителем, чтобы
    в прогнозе были все три цвета: кто-то выполняет, кто-то чуть не дотягивает,
    кто-то не дотягивает. Только если планов ещё нет.
  */
  let targetsAdded = 0;
  const [{ targets }] = await db.select({ targets: sql<number>`COUNT(*)` }).from(salesTargets).where(eq(salesTargets.tenantId, tenantId));
  if (Number(targets) === 0) {
    const agents = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "agent"), eq(users.status, "active"))).orderBy(asc(users.id));
    const since = new Date(now.getTime() - 90 * 86_400_000);
    const pace = await db.select({
      agentId: orders.agentId,
      revenue: sql<string>`COALESCE(SUM(${orders.total}), 0)`,
      count: sql<number>`COUNT(*)`,
    }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.status, "delivered"), sql`${orders.deliveredAt} >= ${since}`))
      .groupBy(orders.agentId);
    const paceOf = new Map(pace.map(p => [Number(p.agentId), { revenue: Number(p.revenue) / 3, count: Number(p.count) / 3 }]));
    const months = [0, 1].map(k => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k + 1, 0));
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
    });
    const targetRows: Array<typeof salesTargets.$inferInsert> = [];
    agents.forEach((a, i) => {
      const p = paceOf.get(Number(a.id)) ?? { revenue: 0, count: 0 };
      const mult = PITCH_PLAN_MULTIPLIERS[i % PITCH_PLAN_MULTIPLIERS.length];
      const { amount, orderCount } = pitchPlanFor(p.revenue, p.count, mult);
      for (const m of months) {
        targetRows.push({
          tenantId, userId: Number(a.id), periodType: "monthly",
          periodStart: sql`${m.start}` as never, periodEnd: sql`${m.end}` as never,
          targetAmount: amount.toFixed(2), orderCountTarget: orderCount, visitTarget: "90",
        });
      }
    });
    if (targetRows.length > 0) await db.insert(salesTargets).values(targetRows);
    targetsAdded = targetRows.length;
  }

  return { supervisorAdded, stocked, paymentsAdded, plansAdded, targetsAdded };
}
