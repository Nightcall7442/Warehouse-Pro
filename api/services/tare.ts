import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { tareTypes, tareMovements, products, shops, warehouses, orders, returns, payments, settings, users } from "@db/schema";
import { badRequest } from "../lib/errors";
import { sanitizeString } from "../lib/sanitize";
import { recalcShopDebt } from "./shop-debt";

/*
  Возвратная тара.

  ── Две правды ─────────────────────────────────────────────────────────────

  Штуки: у кого сколько бутылок, ящиков, кег — на складе, на машине, у
  магазина. Залог: сколько это стоит, если не вернут. Залог — свойство вида
  тары; ноль — фирма считает только штуками. Так программа подходит обеим:
  тем, кто берёт залог, и тем, кто нет.

  ── Тара следует за товаром ────────────────────────────────────────────────

  Каждое движение остатка товара с тарой (дверь stock-ledger) рождает
  движение тары: приход — тара на склад; загрузка машины — со склада на
  машину; продажа — с машины/склада магазину; возврат товара — обратно;
  пересчёт — вместе с товаром. Руками ничего не дублируется, и тара не
  может «потеряться» между документами.

  Отдельно — то, что не идёт с товаром: ПУСТАЯ тара обратно от магазина
  (на машину или на склад) и невозвращённая — списанием в долг магазина
  деньгами по залогу (обычным долгом, тем же путём, что все долги).

  ── Антиворовское ──────────────────────────────────────────────────────────

  Тара на машине — как товар: при пересчёте машины недостача тары ложится
  долгом водителя по залогу. Тара у магазина — долг магазина штуками и
  деньгами; директор видит, кто держит и сколько.
*/

type Db = ReturnType<typeof import("../queries/connection").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Actor = { id: number; name: string; role: string };
export type Holder = { kind: "warehouse" | "shop"; id: number };
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const TARE_PLANS = new Set(["trial", "pro", "exclusive"]);

export function planAllowsTare(plan: string): boolean {
  return TARE_PLANS.has(plan);
}

export async function assertTare(db: Db, tenantId: number, plan: string): Promise<void> {
  if (!planAllowsTare(plan)) throw badRequest("Учёт тары доступен на тарифах Pro и Exclusive");
  const [row] = await db.select({ on: settings.tareEnabled }).from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  if (!row?.on) throw badRequest("Учёт тары выключен — включите его в Настройках");
}

/**
 * Куда уходит тара при движении товара. Чистая функция — её стережёт тест.
 * Возвращает движения: склад всегда; магазин — когда товар уехал к нему или
 * вернулся от него. Величина — количество товара × тары на единицу.
 */
export function followPlan(m: { type: "in" | "out" | "adjustment"; reason: string; quantity: number; perUnit: number; warehouseId: number; shopId: number | null }): Array<{ holder: Holder; delta: number }> {
  const units = round3(Math.abs(m.quantity) * m.perUnit);
  if (!(units > 0)) return [];
  const sign = m.type === "in" ? 1 : m.type === "out" ? -1 : 0;
  if (sign === 0) return [];
  const out: Array<{ holder: Holder; delta: number }> = [{ holder: { kind: "warehouse", id: m.warehouseId }, delta: sign * units }];
  const toShop = m.reason === "order_delivery" || m.reason === "order_return" || m.reason === "return_completed" || m.reason === "order_edit";
  if (toShop && m.shopId) out.push({ holder: { kind: "shop", id: m.shopId }, delta: -sign * units });
  return out;
}

/** Крючок двери остатка: товар двинулся — тара за ним. Молчит, если тары у товара нет. */
export async function followStock(tx: Tx | Db, m: { tenantId: number; warehouseId: number; productId: number; type: "in" | "out" | "adjustment"; quantity: number; reason: string; referenceId: number | null }): Promise<void> {
  const [p] = await tx.select({ tareTypeId: products.tareTypeId, perUnit: products.tarePerUnit }).from(products)
    .where(and(eq(products.id, m.productId), eq(products.tenantId, m.tenantId))).limit(1);
  if (!p?.tareTypeId) return;
  let shopId: number | null = null;
  if (m.referenceId && (m.reason === "order_delivery" || m.reason === "order_return")) {
    const [o] = await tx.select({ shopId: orders.shopId }).from(orders).where(and(eq(orders.id, m.referenceId), eq(orders.tenantId, m.tenantId))).limit(1);
    shopId = o?.shopId ?? null;
  } else if (m.referenceId && m.reason === "return_completed") {
    const [r] = await tx.select({ shopId: returns.shopId }).from(returns).where(and(eq(returns.id, m.referenceId), eq(returns.tenantId, m.tenantId))).limit(1);
    shopId = r?.shopId ?? null;
  }
  const plan = followPlan({ type: m.type, reason: m.reason, quantity: m.quantity, perUnit: Number(p.perUnit), warehouseId: m.warehouseId, shopId });
  if (!plan.length) return;
  await tx.insert(tareMovements).values(plan.map(x => ({
    tenantId: m.tenantId, tareTypeId: p.tareTypeId!, holderKind: x.holder.kind, holderId: x.holder.id, delta: x.delta.toFixed(3),
    reason: "follow" as const, referenceId: m.referenceId ?? null, note: m.reason,
  })));
}

async function balances(db: Db | Tx, tenantId: number, holder?: Holder) {
  const rows = await db.select({
    holderKind: tareMovements.holderKind, holderId: tareMovements.holderId, tareTypeId: tareMovements.tareTypeId,
    qty: sql<string>`coalesce(sum(${tareMovements.delta}), 0)`,
  }).from(tareMovements)
    .where(and(eq(tareMovements.tenantId, tenantId), ...(holder ? [eq(tareMovements.holderKind, holder.kind), eq(tareMovements.holderId, holder.id)] : [])))
    .groupBy(tareMovements.holderKind, tareMovements.holderId, tareMovements.tareTypeId);
  return rows.map(r => ({ kind: r.holderKind, id: Number(r.holderId), tareTypeId: Number(r.tareTypeId), qty: round3(Number(r.qty)) })).filter(r => r.qty !== 0);
}

export const TareService = {
  async types(db: Db, tenantId: number) {
    const rows = await db.select().from(tareTypes).where(eq(tareTypes.tenantId, tenantId)).orderBy(tareTypes.name);
    return rows.map(r => ({ ...r, depositPrice: Number(r.depositPrice) }));
  },

  async saveType(db: Db, tenantId: number, actor: Actor, input: { id?: number; name: string; depositPrice: number; isActive?: boolean }) {
    const name = sanitizeString(input.name);
    if (!name) throw badRequest("У вида тары должно быть название");
    if (!(input.depositPrice >= 0)) throw badRequest("Залог не может быть отрицательным");
    let id = input.id ?? 0;
    if (input.id) {
      const [ok] = await db.select({ id: tareTypes.id }).from(tareTypes).where(and(eq(tareTypes.id, input.id), eq(tareTypes.tenantId, tenantId))).limit(1);
      if (!ok) throw badRequest("Вид тары не найден");
      await db.update(tareTypes).set({ name, depositPrice: input.depositPrice.toFixed(2), isActive: input.isActive ?? true }).where(eq(tareTypes.id, input.id));
    } else {
      const [r] = await db.insert(tareTypes).values({ tenantId, name, depositPrice: input.depositPrice.toFixed(2), isActive: input.isActive ?? true });
      id = Number(r.insertId);
    }
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: input.id ? "tare.type_updated" : "tare.type_created", targetType: "tare_type", targetId: id, targetLabel: name, meta: { deposit: input.depositPrice } });
    return { id };
  },

  /** Тара товара: вид и сколько на единицу. Пусто — товар без тары. */
  async setProductTare(db: Db, tenantId: number, actor: Actor, input: { productId: number; tareTypeId: number | null; perUnit: number }) {
    if (input.tareTypeId) {
      const [ok] = await db.select({ id: tareTypes.id }).from(tareTypes).where(and(eq(tareTypes.id, input.tareTypeId), eq(tareTypes.tenantId, tenantId))).limit(1);
      if (!ok) throw badRequest("Вид тары не найден");
      if (!(input.perUnit > 0)) throw badRequest("Тары на единицу товара должно быть больше нуля");
    }
    const [p] = await db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.id, input.productId), eq(products.tenantId, tenantId))).limit(1);
    if (!p) throw badRequest("Товар не найден");
    await db.update(products).set({ tareTypeId: input.tareTypeId, tarePerUnit: (input.tareTypeId ? input.perUnit : 1).toFixed(3) }).where(eq(products.id, p.id));
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "tare.product_set", targetType: "product", targetId: p.id, targetLabel: p.name, meta: { tareTypeId: input.tareTypeId, perUnit: input.perUnit } });
    return { ok: true };
  },

  /** Обзор: по складам и машинам (штуки) и по магазинам (штуки и залог), по видам. */
  async overview(db: Db, tenantId: number) {
    const [types, all, whs] = await Promise.all([
      this.types(db, tenantId), balances(db, tenantId),
      db.select({ id: warehouses.id, name: warehouses.name, kind: warehouses.kind }).from(warehouses).where(eq(warehouses.tenantId, tenantId)),
    ]);
    const price = new Map(types.map(t => [t.id, t.depositPrice]));
    const shopIds = [...new Set(all.filter(b => b.kind === "shop").map(b => b.id))];
    const shopRows = shopIds.length ? await db.select({ id: shops.id, name: shops.name }).from(shops).where(inArray(shops.id, shopIds)) : [];
    const shopName = new Map(shopRows.map(s => [s.id, s.name]));
    const whName = new Map(whs.map(w => [w.id, { name: w.name, kind: w.kind }]));
    const group = (kind: "warehouse" | "shop") => {
      const by = new Map<number, { id: number; name: string; van: boolean; lines: Array<{ tareTypeId: number; name: string; qty: number; deposit: number }>; units: number; deposit: number }>();
      for (const b of all.filter(x => x.kind === kind)) {
        const h = by.get(b.id) ?? { id: b.id, name: kind === "shop" ? shopName.get(b.id) ?? `#${b.id}` : whName.get(b.id)?.name ?? `#${b.id}`, van: whName.get(b.id)?.kind === "van", lines: [], units: 0, deposit: 0 };
        const deposit = round2(b.qty * (price.get(b.tareTypeId) ?? 0));
        h.lines.push({ tareTypeId: b.tareTypeId, name: types.find(t => t.id === b.tareTypeId)?.name ?? "", qty: b.qty, deposit });
        h.units = round3(h.units + b.qty); h.deposit = round2(h.deposit + deposit);
        by.set(b.id, h);
      }
      return [...by.values()].sort((a, b) => b.units - a.units);
    };
    const shopsOut = group("shop");
    return {
      types, warehouses: group("warehouse"), shops: shopsOut,
      totals: { atShops: round3(shopsOut.reduce((s, h) => s + h.units, 0)), depositAtShops: round2(shopsOut.reduce((s, h) => s + h.deposit, 0)) },
    };
  },

  /** Тара у одного магазина — для карточки магазина и для приёма на машине. */
  async shop(db: Db, tenantId: number, shopId: number) {
    const [types, b] = await Promise.all([this.types(db, tenantId), balances(db, tenantId, { kind: "shop", id: shopId })]);
    return b.map(x => ({ tareTypeId: x.tareTypeId, name: types.find(t => t.id === x.tareTypeId)?.name ?? "", qty: x.qty, depositPrice: types.find(t => t.id === x.tareTypeId)?.depositPrice ?? 0, deposit: round2(x.qty * (types.find(t => t.id === x.tareTypeId)?.depositPrice ?? 0)) }));
  },

  /** Пустая тара от магазина — на склад или на машину. Больше, чем у магазина числится, принять нельзя. */
  async returnFromShop(db: Db, tenantId: number, actor: Actor, input: { shopId: number; warehouseId: number; items: Array<{ tareTypeId: number; quantity: number }>; note?: string | null }) {
    const [wh] = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(and(eq(warehouses.id, input.warehouseId), eq(warehouses.tenantId, tenantId))).limit(1);
    if (!wh) throw badRequest("Склад не найден");
    const [shop] = await db.select({ id: shops.id, name: shops.name }).from(shops).where(and(eq(shops.id, input.shopId), eq(shops.tenantId, tenantId))).limit(1);
    if (!shop) throw badRequest("Магазин не найден");
    const held = await this.shop(db, tenantId, shop.id);
    const rows: Array<typeof tareMovements.$inferInsert> = [];
    let total = 0;
    for (const it of input.items) {
      if (!(it.quantity > 0)) continue;
      const h = held.find(x => x.tareTypeId === it.tareTypeId);
      if (!h || h.qty + 1e-6 < it.quantity) throw badRequest(`У магазина «${shop.name}» числится ${h?.qty ?? 0} ${h?.name ?? "тары"} — принять ${it.quantity} нельзя`);
      total += it.quantity;
      const note = `Возврат тары от «${shop.name}»${input.note ? ` · ${sanitizeString(input.note)}` : ""}`.slice(0, 255);
      rows.push({ tenantId, tareTypeId: it.tareTypeId, holderKind: "shop", holderId: shop.id, delta: (-it.quantity).toFixed(3), reason: "return", note, createdBy: actor.id });
      rows.push({ tenantId, tareTypeId: it.tareTypeId, holderKind: "warehouse", holderId: wh.id, delta: it.quantity.toFixed(3), reason: "return", note, createdBy: actor.id });
    }
    if (!rows.length) throw badRequest("Укажите, сколько тары вернулось");
    await db.insert(tareMovements).values(rows);
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "tare.returned", targetType: "shop", targetId: shop.id, targetLabel: shop.name, meta: { warehouse: wh.name, units: total } });
    return { units: total };
  },

  /**
   * Невозвращённая тара — в долг магазина деньгами по залогу: обычная строка
   * долга, собирается как любой долг. Штуки с магазина снимаются. Без залога
   * (ноль) списать «в деньги» нечего — только снять штуки с причиной.
   */
  async charge(db: Db, tenantId: number, actor: Actor, input: { shopId: number; tareTypeId: number; quantity: number; reason: string }) {
    if (!(input.quantity > 0)) throw badRequest("Количество должно быть больше нуля");
    const reason = sanitizeString(input.reason);
    if (!reason) throw badRequest("Списание тары без причины не проводится");
    const [shop] = await db.select({ id: shops.id, name: shops.name }).from(shops).where(and(eq(shops.id, input.shopId), eq(shops.tenantId, tenantId))).limit(1);
    if (!shop) throw badRequest("Магазин не найден");
    const held = (await this.shop(db, tenantId, shop.id)).find(x => x.tareTypeId === input.tareTypeId);
    if (!held || held.qty + 1e-6 < input.quantity) throw badRequest(`У магазина «${shop.name}» числится ${held?.qty ?? 0} ${held?.name ?? "тары"} — списать ${input.quantity} нельзя`);
    const amount = round2(input.quantity * held.depositPrice);
    await db.transaction(async (tx) => {
      await tx.insert(tareMovements).values({ tenantId, tareTypeId: input.tareTypeId, holderKind: "shop", holderId: shop.id, delta: (-input.quantity).toFixed(3), reason: "charge", note: reason.slice(0, 255), createdBy: actor.id });
      if (amount > 0) {
        await tx.insert(payments).values({ tenantId, shopId: shop.id, amount: amount.toFixed(2), type: "debt", notes: `Тара не возвращена: ${input.quantity} × ${held.name} по залогу · ${reason}`.slice(0, 500), createdBy: actor.id });
        await recalcShopDebt(tx, tenantId, shop.id);
      }
    });
    const { recordAudit } = await import("./audit-log");
    await recordAudit(db, { tenantId, actorId: actor.id, actorName: actor.name, action: "tare.charged", targetType: "shop", targetId: shop.id, targetLabel: shop.name, meta: { tare: held.name, quantity: input.quantity, amount, reason } });
    return { amount };
  },

  /**
   * Пересчёт тары на машине или складе: чего нет — снимается; при пересчёте
   * машины разница по залогу ложится долгом водителя (van.ts зовёт это
   * внутри своей транзакции и сам проводит долг).
   */
  async count(tx: Tx | Db, tenantId: number, actor: Actor, input: { warehouseId: number; counted: Array<{ tareTypeId: number; quantity: number }> }) {
    const [types, b] = await Promise.all([this.types(tx as Db, tenantId), balances(tx, tenantId, { kind: "warehouse", id: input.warehouseId })]);
    const lines: Array<{ tareTypeId: number; name: string; system: number; counted: number; diff: number; deposit: number }> = [];
    let shortage = 0;
    for (const c of input.counted) {
      const t = types.find(x => x.id === c.tareTypeId);
      if (!t) throw badRequest("Вид тары не найден");
      if (c.quantity < 0) throw badRequest("Количество не может быть отрицательным");
      const system = b.find(x => x.tareTypeId === c.tareTypeId)?.qty ?? 0;
      const diff = round3(c.quantity - system);
      const deposit = diff < 0 ? round2(-diff * t.depositPrice) : 0;
      lines.push({ tareTypeId: t.id, name: t.name, system, counted: c.quantity, diff, deposit });
      if (diff === 0) continue;
      await tx.insert(tareMovements).values({ tenantId, tareTypeId: t.id, holderKind: "warehouse", holderId: input.warehouseId, delta: diff.toFixed(3), reason: "count", note: `Пересчёт: по системе ${system}, по факту ${c.quantity}`, createdBy: actor.id });
      shortage = round2(shortage + deposit);
    }
    return { lines, shortage };
  },

  /** Журнал движений тары за срок. */
  async movements(db: Db, tenantId: number, input: { from: Date; to: Date; holder?: Holder }) {
    const rows = await db.select({
      id: tareMovements.id, tareTypeId: tareMovements.tareTypeId, holderKind: tareMovements.holderKind, holderId: tareMovements.holderId,
      delta: tareMovements.delta, reason: tareMovements.reason, referenceId: tareMovements.referenceId, note: tareMovements.note, createdAt: tareMovements.createdAt, by: users.name,
    }).from(tareMovements).leftJoin(users, eq(users.id, tareMovements.createdBy))
      .where(and(eq(tareMovements.tenantId, tenantId), sql`${tareMovements.createdAt} >= ${input.from}`, sql`${tareMovements.createdAt} < ${input.to}`,
        ...(input.holder ? [eq(tareMovements.holderKind, input.holder.kind), eq(tareMovements.holderId, input.holder.id)] : [])))
      .orderBy(desc(tareMovements.id)).limit(500);
    const types = await this.types(db, tenantId);
    return rows.map(r => ({ ...r, delta: Number(r.delta), tareName: types.find(t => t.id === Number(r.tareTypeId))?.name ?? "" }));
  },
};
