import { and, desc, eq, gt, gte, inArray, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { orders, orderItems, products, shops, warehouseStock, users, dailyPlans, payments, agentLocations, settings } from "@db/schema";
import { REVENUE_ORDER_STATUSES, OPEN_ORDER_STATUSES, deliveredQty } from "../lib/order-status";
import { tgEscape, fmtMoney, fmtQty, inlineKeyboard, appLink, ORDER_STATE, PAY_LABEL } from "../lib/telegram";
import { T, type Lang, type Period } from "./texts";
import { lowStockRows, lowStockCondition, onDefaultWarehouse } from "../services/reorder";

/* ═══════════════════════════════════════════════════════════════════════════
   Ответы бота — только чтение.

   Бот ничего не меняет. Это решение, а не упущение: телефон теряют и угоняют,
   а разговор с ботом не требует ни пароля, ни второго входа. Пока бот только
   рассказывает, потерянный телефон стоит утечки сводки; умей он подтверждать
   заказы — стоил бы поддельных отгрузок.

   ── Scope: кто спрашивает ──────────────────────────────────────────────────

   Все запросы ограничены организацией спрашивающего. Идентификатор берётся из
   привязки чата к пользователю, а не из сообщения. Агент и курьер видят только
   своё: scope.agentId сужает заказы, долги и визиты до его магазинов,
   scope.courierId — доставки до его маршрута. Одна функция на вопрос, а не
   две копии «для директора» и «для агента», которые разошлись бы через месяц.

   ── Вид ────────────────────────────────────────────────────────────────────

   Карточка: заголовок значком и жирным, подзаголовок курсивом, строки
   «что — сколько», итог. Числа — с тысячами через пробел и валютой словом.
   Под сообщением кнопки: срок сводки, «Ожидают», «Открыть в приложении».
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Scope {
  tenantId: number;
  lang: Lang;
  /** Агент или мерчандайзер: только его магазины, заказы, визиты. */
  agentId?: number;
  /** Курьер: только его доставки и касса. */
  courierId?: number;
  /** Имя — для утреннего приветствия. */
  agentName?: string;
  currency: string;
}

export interface Reply { text: string; extra?: Record<string, unknown> }

/** Сколько строк помещается в одно сообщение, не превращая его в простыню. */
const LIMIT = 8;
const TASHKENT_MS = 5 * 3600 * 1000;

/** Валюта организации — словом, как в настройках. */
export async function currencyOf(tenantId: number): Promise<string> {
  const [row] = await getDb().select({ symbol: settings.currencySymbol, code: settings.currency })
    .from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  return row?.symbol || row?.code || "сум";
}

/** «Эшмуродов Ж.» — фамилия и инициал: в строке на телефоне место дорого. */
export function shortName(full: string | null | undefined): string {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "—";
  return `${parts[0]} ${parts[1][0]}.`;
}

/** Начало суток по Ташкенту для момента, в UTC. */
export function tashkentDayStart(at: Date, shiftDays = 0): Date {
  const local = new Date(at.getTime() + TASHKENT_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + shiftDays);
  return new Date(start - TASHKENT_MS);
}

/** Границы срока и такого же срока до него — для «до этого: …». */
export function periodRange(period: Period, now = new Date()): { from: Date; to: Date; prevFrom: Date; prevTo: Date; label: keyof typeof T } {
  const today = tashkentDayStart(now);
  const tomorrow = tashkentDayStart(now, 1);
  switch (period) {
    case "yesterday": return { from: tashkentDayStart(now, -1), to: today, prevFrom: tashkentDayStart(now, -2), prevTo: tashkentDayStart(now, -1), label: "pYesterday" };
    case "week":      return { from: tashkentDayStart(now, -6), to: tomorrow, prevFrom: tashkentDayStart(now, -13), prevTo: tashkentDayStart(now, -6), label: "pWeek" };
    case "month":     return { from: tashkentDayStart(now, -29), to: tomorrow, prevFrom: tashkentDayStart(now, -59), prevTo: tashkentDayStart(now, -29), label: "pMonth" };
    default:          return { from: today, to: tomorrow, prevFrom: tashkentDayStart(now, -1), prevTo: today, label: "pToday" };
  }
}

/** «2026-09-16» по Ташкенту — для колонок DATE, у которых времени нет. */
export function dayStr(at: Date): string {
  return new Date(at.getTime() + TASHKENT_MS).toISOString().slice(0, 10);
}
/** Визиты в [from, to) по дню плана. */
const planBetween = (from: Date, to: Date) => sql`${dailyPlans.planDate} >= ${dayStr(from)} AND ${dailyPlans.planDate} < ${dayStr(to)}`;

const hhmm = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const local = new Date(new Date(d).getTime() + TASHKENT_MS);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};
const ddmm = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const local = new Date(new Date(d).getTime() + TASHKENT_MS);
  return `${String(local.getUTCDate()).padStart(2, "0")}.${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
};
const todayLabel = (now = new Date()) => {
  const local = new Date(now.getTime() + TASHKENT_MS);
  return `${String(local.getUTCDate()).padStart(2, "0")}.${String(local.getUTCMonth() + 1).padStart(2, "0")}.${local.getUTCFullYear()}`;
};

/** Карточка: заголовок, подзаголовок, строки; пустой список говорит об этом словами. */
function card(title: string, sub: string | null, lines: string[], empty?: string): string {
  const head = `<b>${title}</b>${sub ? `\n<i>${sub}</i>` : ""}`;
  if (lines.length === 0) return `${head}\n\n${empty ?? ""}`.trimEnd();
  return `${head}\n\n${lines.join("\n")}`;
}

const state = (status: string, lang: Lang) => {
  const s = ORDER_STATE[status] ?? { icon: "•", ru: status, uz: status };
  return { icon: s.icon, word: s[lang] };
};

const openButton = (lang: Lang, path: string) => ({ text: T.wOpen[lang], url: appLink(path) });

/* ═══════════════════════════════════════════════════════════════════════════
   Сводка — за сегодня, вчера, неделю, месяц.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function answerSummary(scope: Scope, period: Period = "today", now = new Date()): Promise<Reply> {
  const db = getDb();
  const { tenantId, lang, agentId, currency } = scope;
  const r = periodRange(period, now);

  const own = agentId ? [eq(orders.agentId, agentId)] : [];
  const ownShop = agentId ? [eq(shops.agentId, agentId)] : [];
  const live = and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), ne(orders.status, "cancelled"), ...own);

  const ordersIn = (from: Date, to: Date) => db.select({
    count: sql<number>`count(*)`,
    total: sql<number>`coalesce(sum(${orders.total}), 0)`,
  }).from(orders).where(and(live, gte(orders.createdAt, from), lt(orders.createdAt, to)));

  const [[cur], [prev], [delivered], [inWork], [pending], paid, [debt], [visits], low, best] = await Promise.all([
    ordersIn(r.from, r.to),
    ordersIn(r.prevFrom, r.prevTo),
    db.select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${orders.total}), 0)` })
      .from(orders).where(and(live, inArray(orders.status, REVENUE_ORDER_STATUSES), isNull(orders.deletedAt),
        gte(sql`coalesce(${orders.deliveredAt}, ${orders.createdAt})`, r.from), lt(sql`coalesce(${orders.deliveredAt}, ${orders.createdAt})`, r.to))),
    // «В работе» — открытые без ожидающих: те считаются отдельной строкой.
    db.select({ count: sql<number>`count(*)` }).from(orders).where(and(live, inArray(orders.status, OPEN_ORDER_STATUSES.filter(s => s !== "pending")))),
    db.select({ count: sql<number>`count(*)` }).from(orders).where(and(live, eq(orders.status, "pending"))),
    db.select({ method: payments.paymentMethod, total: sql<number>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .innerJoin(shops, and(eq(shops.id, payments.shopId), eq(shops.tenantId, tenantId), ...ownShop))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.type, "payment"), gte(payments.createdAt, r.from), lt(payments.createdAt, r.to)))
      .groupBy(payments.paymentMethod),
    db.select({ total: sql<number>`coalesce(sum(${shops.debt}), 0)` }).from(shops).where(and(eq(shops.tenantId, tenantId), ...ownShop)),
    db.select({
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${dailyPlans.status} = 'visited' then 1 else 0 end)`,
    }).from(dailyPlans).where(and(eq(dailyPlans.tenantId, tenantId), planBetween(r.from, r.to), ...(agentId ? [eq(dailyPlans.agentId, agentId)] : []))),
    agentId ? Promise.resolve([{ count: 0 }]) : db.select({ count: sql<number>`count(*)` })
      .from(warehouseStock)
      .innerJoin(products, and(eq(products.id, warehouseStock.productId), eq(products.tenantId, tenantId)))
      .where(and(eq(warehouseStock.tenantId, tenantId), eq(products.status, "active"), onDefaultWarehouse(tenantId), lowStockCondition())),
    agentId ? Promise.resolve([] as Array<{ name: string | null; total: number }>) : db.select({ name: users.name, total: sql<number>`coalesce(sum(${orders.total}), 0)` })
      .from(orders).innerJoin(users, eq(users.id, orders.agentId))
      .where(and(live, gte(orders.createdAt, r.from), lt(orders.createdAt, r.to)))
      .groupBy(users.id, users.name).orderBy(desc(sql`sum(${orders.total})`)).limit(1),
  ]);

  const paidTotal = paid.reduce((s, p) => s + Number(p.total), 0);
  const paidParts = paid.filter(p => Number(p.total) > 0)
    .map(p => `${PAY_LABEL[p.method ?? ""] ?? p.method} ${fmtMoney(p.total, "").trim()}`).join(" · ");
  const vTotal = Number(visits?.total ?? 0), vDone = Number(visits?.done ?? 0);
  const pct = vTotal > 0 ? Math.round((vDone / vTotal) * 100) : 0;

  const lines = [
    `🛒 ${T.wOrders[lang]}: <b>${Number(cur?.count ?? 0)}</b> · ${fmtMoney(cur?.total, currency)}`,
    `   ${T.wPrev[lang]}: ${Number(prev?.count ?? 0)} · ${fmtMoney(prev?.total, currency)}`,
    `✅ ${T.wDelivered[lang]}: <b>${Number(delivered?.count ?? 0)}</b> · ${fmtMoney(delivered?.total, currency)}`,
    `🔧 ${T.wInWork[lang]}: ${Number(inWork?.count ?? 0)} · ⏳ ${T.wPending[lang]}: ${Number(pending?.count ?? 0)}`,
    `💵 ${T.wCash[lang]}: <b>${fmtMoney(paidTotal, currency)}</b>` + (paidParts ? `\n   ${paidParts}` : ""),
    `🧾 ${T.wDebt[lang]}: ${fmtMoney(debt?.total, currency)}`,
    `📍 ${T.wVisits[lang]}: ${vDone} ${T.wOf[lang]} ${vTotal}${vTotal ? ` (${pct}%)` : ""}`,
  ];
  if (!agentId) {
    lines.push(`📦 ${T.wLow[lang]}: ${Number(low[0]?.count ?? 0)}`);
    if (best[0] && Number(best[0].total) > 0) lines.push(`🏆 ${T.wBest[lang]}: ${tgEscape(shortName(best[0].name))} — ${fmtMoney(best[0].total, currency)}`);
  }

  const title = `📊 ${agentId ? T.hMyResult[lang] : T.hSummary[lang]} · ${T[r.label][lang]}`;
  const periods: Period[] = ["today", "yesterday", "week", "month"];
  const labels: Record<Period, keyof typeof T> = { today: "pToday", yesterday: "pYesterday", week: "pWeek", month: "pMonth" };
  return {
    text: card(title, todayLabel(now), lines),
    extra: inlineKeyboard([
      periods.map(p => ({ text: (p === period ? "• " : "") + T[labels[p]][lang], data: `sum:${p}` })),
      ...(agentId ? [] : [[openButton(lang, "/dashboard")]]),
    ]),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Заказы: последние, ожидающие подтверждения.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function answerOrders(scope: Scope): Promise<Reply> {
  const { tenantId, lang, agentId, currency } = scope;
  const db = getDb();
  const own = agentId ? [eq(orders.agentId, agentId)] : [];
  const rows = await db.select({
    number: orders.orderNumber, total: orders.total, status: orders.status,
    shop: shops.name, agent: users.name, at: orders.createdAt,
  })
    .from(orders)
    .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, orders.agentId))
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), ...own))
    .orderBy(desc(orders.id)).limit(LIMIT);

  const [[pending]] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), eq(orders.status, "pending"), ...own)),
  ]);

  const lines = rows.map(r => {
    const s = state(r.status, lang);
    const who = agentId ? "" : ` · 👤 ${tgEscape(shortName(r.agent))}`;
    return `${s.icon} <b>${tgEscape(r.number)}</b> · ${tgEscape(r.shop ?? "—")} — ${fmtMoney(r.total, currency)}\n   ${s.word} · ${ddmm(r.at)} ${hhmm(r.at)}${who}`;
  });
  const n = Number(pending?.count ?? 0);
  return {
    text: card(`🛒 ${agentId ? T.hMyOrders[lang] : T.hOrders[lang]}`, null, lines, T.nothing[lang]),
    extra: inlineKeyboard([[
      ...(n > 0 ? [{ text: `⏳ ${T.hPending[lang]} (${n})`, data: "pending" }] : []),
      openButton(lang, "/orders"),
    ]]),
  };
}

export async function answerPending(scope: Scope): Promise<Reply> {
  const { tenantId, lang, agentId, currency } = scope;
  const rows = await getDb().select({
    number: orders.orderNumber, total: orders.total, subtotal: orders.subtotal, discount: orders.discount,
    reason: orders.holdReason, shop: shops.name, agent: users.name, at: orders.createdAt,
  })
    .from(orders)
    .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, orders.agentId))
    .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), eq(orders.status, "pending"), ...(agentId ? [eq(orders.agentId, agentId)] : [])))
    .orderBy(desc(orders.id)).limit(LIMIT);

  const lines = rows.map(r => {
    const sub = Number(r.subtotal), disc = Number(r.discount);
    const pct = sub > 0 && disc > 0 ? ` · ${T.wDiscount[lang]} ${Math.round((disc / sub) * 100)}%` : "";
    const who = agentId ? "" : `👤 ${tgEscape(shortName(r.agent))} · `;
    return `⏳ <b>${tgEscape(r.number)}</b> · ${tgEscape(r.shop ?? "—")} — ${fmtMoney(r.total, currency)}${pct}\n   ${who}${ddmm(r.at)} ${hhmm(r.at)}${r.reason ? `\n   ❗ ${tgEscape(r.reason)}` : ""}`;
  });
  const text = card(`⏳ ${T.hPending[lang]}`, null, lines, T.wNoPending[lang]) + (rows.length && !agentId ? `\n\n${T.wConfirmHint[lang]}` : "");
  return { text, extra: agentId ? undefined : inlineKeyboard([[openButton(lang, "/orders")]]) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Агенты сегодня: продажи, визиты, связь.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function answerAgents(scope: Scope, now = new Date()): Promise<Reply> {
  const { tenantId, lang, currency } = scope;
  const db = getDb();
  const from = tashkentDayStart(now), to = tashkentDayStart(now, 1);

  const [sales, visits, seen] = await Promise.all([
    db.select({ id: users.id, name: users.name, count: sql<number>`count(${orders.id})`, total: sql<number>`coalesce(sum(${orders.total}), 0)` })
      .from(users)
      .leftJoin(orders, and(eq(orders.agentId, users.id), isNull(orders.deletedAt), ne(orders.status, "cancelled"), gte(orders.createdAt, from), lt(orders.createdAt, to)))
      .where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), inArray(users.role, ["agent", "merchandiser"])))
      .groupBy(users.id, users.name),
    db.select({ agentId: dailyPlans.agentId, total: sql<number>`count(*)`, done: sql<number>`sum(case when ${dailyPlans.status} = 'visited' then 1 else 0 end)` })
      .from(dailyPlans).where(and(eq(dailyPlans.tenantId, tenantId), planBetween(from, to)))
      .groupBy(dailyPlans.agentId),
    db.select({ agentId: agentLocations.agentId, last: sql<Date>`max(${agentLocations.createdAt})` })
      .from(agentLocations).where(and(eq(agentLocations.tenantId, tenantId), gte(agentLocations.createdAt, from)))
      .groupBy(agentLocations.agentId),
  ]);
  const v = new Map(visits.map(x => [Number(x.agentId), x]));
  const s = new Map(seen.map(x => [Number(x.agentId), x.last]));

  const lines = sales
    .sort((a, b) => Number(b.total) - Number(a.total))
    .map(a => {
      const vis = v.get(Number(a.id));
      const last = s.get(Number(a.id));
      const visitPart = vis ? `📍 ${Number(vis.done)}/${Number(vis.total)}` : `📍 —`;
      const signal = last ? `🟢 ${hhmm(last)}` : `⚪ ${T.wNoSignal[lang]}`;
      return `👤 <b>${tgEscape(shortName(a.name))}</b> — ${Number(a.count)} · ${fmtMoney(a.total, currency)}\n   ${visitPart} · ${signal}`;
    });
  return { text: card(`👥 ${T.hAgents[lang]}`, todayLabel(now), lines, T.wNoAgents[lang]), extra: inlineKeyboard([[openButton(lang, "/supervisor")]]) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Доставки: по курьерам для офиса, списком для курьера.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function answerDeliveries(scope: Scope, now = new Date()): Promise<Reply> {
  const { tenantId, lang, courierId, currency } = scope;
  const db = getDb();
  const from = tashkentDayStart(now);
  const recent = tashkentDayStart(now, -2);
  const cond = and(
    eq(orders.tenantId, tenantId), isNull(orders.deletedAt),
    ...(courierId ? [eq(orders.courierId, courierId)] : []),
    or(
      inArray(orders.deliveryStatus, ["assigned", "out_for_delivery"]),
      and(eq(orders.deliveryStatus, "delivered"), gte(orders.deliveredAt, from)),
      and(eq(orders.deliveryStatus, "failed"), gte(orders.createdAt, recent)),
    ),
  );
  const rows = await db.select({
    number: orders.orderNumber, total: orders.total, ds: orders.deliveryStatus, pay: orders.paymentMethod,
    shop: shops.name, address: shops.address, courierId: orders.courierId, courier: users.name,
  })
    .from(orders)
    .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, orders.courierId))
    .where(cond).orderBy(desc(orders.id)).limit(courierId ? 30 : 200);

  const DS: Record<string, string> = { assigned: "📦", out_for_delivery: "🚚", delivered: "✅", failed: "❌" };

  if (courierId) {
    const lines = rows.map(r =>
      `${DS[r.ds] ?? "•"} <b>${tgEscape(r.number)}</b> · ${tgEscape(r.shop ?? "—")} — ${fmtMoney(r.total, currency)} · ${PAY_LABEL[r.pay] ?? r.pay}` +
      (r.address ? `\n   📍 ${tgEscape(r.address)}` : ""));
    return { text: card(`🚚 ${T.hMyDeliveries[lang]}`, todayLabel(now), lines, T.wNoDeliveries[lang]) };
  }

  const byCourier = new Map<string, { name: string; done: number; road: number; failed: number; sum: number }>();
  for (const r of rows) {
    const key = String(r.courierId ?? "—");
    const c = byCourier.get(key) ?? { name: r.courier ?? "—", done: 0, road: 0, failed: 0, sum: 0 };
    if (r.ds === "delivered") { c.done++; c.sum += Number(r.total); }
    else if (r.ds === "failed") c.failed++;
    else c.road++;
    byCourier.set(key, c);
  }
  const lines = [...byCourier.values()].map(c =>
    `🚚 <b>${tgEscape(shortName(c.name))}</b> — ✅ ${c.done} · 📦 ${c.road} · ❌ ${c.failed}\n   ${T.wDelivered[lang]}: ${fmtMoney(c.sum, currency)}`);
  return { text: card(`🚚 ${T.hDeliveries[lang]}`, todayLabel(now), lines, T.wNoDeliveries[lang]), extra: inlineKeyboard([[openButton(lang, "/orders")]]) };
}

/**
 * Касса сотрудника — по кассовому учёту (services/cash.ts): на руках,
 * принято сегодня, долг, лимит и час сдачи. Не «сколько записал платежей»,
 * а «сколько должен сдать» — это разные числа, и второе здесь.
 */
export async function answerCash(scope: Scope, now = new Date()): Promise<Reply> {
  const { tenantId, lang, courierId, agentId, currency } = scope;
  const userId = courierId ?? agentId;
  if (!userId) return { text: T.notUnderstood[lang] };
  const { CashService } = await import("../services/cash");
  const m = await CashService.mine(getDb(), tenantId, userId, now);
  const lines = [
    `💵 ${T.wOnHand[lang]}: <b>${fmtMoney(m.onHand, currency)}</b>${m.onHand > m.limit ? ` ⚠️ ${T.wOverLimit[lang]} ${fmtMoney(m.limit, currency)}` : ""}`,
    `📥 ${T.wTodayIn[lang]}: ${fmtMoney(m.todayIn, currency)} (${m.todayCount})`,
    ...(m.debt > 0 ? [`🧾 ${T.wMyDebt[lang]}: <b>${fmtMoney(m.debt, currency)}</b>`] : []),
    `⏰ ${T.wHandoverBy[lang]} ${m.deadline}`,
  ];
  const last = m.documents.slice(0, 3).map(d => `• ${d.kind === "pko" ? "ПКО" : "РКО"}-${String(d.number).padStart(4, "0")} · ${ddmm(d.createdAt)} — ${fmtMoney(d.amount, currency)}${d.discrepancy && Number(d.discrepancy) !== 0 ? ` (${Number(d.discrepancy) < 0 ? "−" : "+"}${fmtMoney(Math.abs(Number(d.discrepancy)), currency)})` : ""}`);
  if (last.length) lines.push("", `<i>${T.wLastHandovers[lang]}</i>`, ...last);
  return { text: card(`💵 ${T.hCash[lang]}`, todayLabel(now), lines) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Склад, топ, долги.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function answerStock(scope: Scope): Promise<Reply> {
  const { tenantId, lang } = scope;
  const rows = await lowStockRows(getDb(), tenantId, LIMIT);
  const lines = rows.map(r =>
    `• ${tgEscape(r.productName)} — <b>${fmtQty(r.available)}</b> ${tgEscape(r.unit)} (${T.wThreshold[lang]} ${fmtQty(r.reorderPoint)})`);
  return { text: card(`📦 ${T.hStock[lang]}`, null, lines, T.wStockOk[lang]), extra: scope.agentId || scope.courierId ? undefined : inlineKeyboard([[openButton(lang, "/warehouse")]]) };
}

export async function answerTop(scope: Scope, now = new Date()): Promise<Reply> {
  const { tenantId, lang, currency } = scope;
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const rows = await getDb().select({
    name: products.name, unit: products.unit,
    // По ДОСТАВЛЕННОМУ количеству: заказанное включает то, что вернули.
    sold: sql<number>`COALESCE(sum(${deliveredQty()}), 0)`,
    revenue: sql<number>`COALESCE(sum(${deliveredQty()} * ${orderItems.unitPrice}), 0)`,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, and(eq(products.id, orderItems.productId), eq(products.tenantId, tenantId)))
    .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, since), inArray(orders.status, REVENUE_ORDER_STATUSES), isNull(orders.deletedAt)))
    .groupBy(products.id, products.name, products.unit)
    .orderBy(desc(sql`sum(${deliveredQty()} * ${orderItems.unitPrice})`))
    .limit(LIMIT);
  const lines = rows.map((r, i) => `${i + 1}. <b>${tgEscape(r.name)}</b> — ${fmtQty(r.sold)} ${tgEscape(r.unit)} · ${fmtMoney(r.revenue, currency)}`);
  return { text: card(`🏆 ${T.hTop[lang]}`, null, lines, T.nothing[lang]) };
}

export async function answerDebts(scope: Scope): Promise<Reply> {
  const { tenantId, lang, agentId, currency } = scope;
  const db = getDb();
  const own = agentId ? [eq(shops.agentId, agentId)] : [];
  const [rows, [sum]] = await Promise.all([
    db.select({ name: shops.name, debt: shops.debt, agent: users.name })
      .from(shops).leftJoin(users, eq(users.id, shops.agentId))
      .where(and(eq(shops.tenantId, tenantId), gt(shops.debt, "0"), ...own))
      .orderBy(desc(shops.debt)).limit(LIMIT + 2),
    db.select({ total: sql<number>`coalesce(sum(${shops.debt}), 0)`, count: sql<number>`count(*)` })
      .from(shops).where(and(eq(shops.tenantId, tenantId), gt(shops.debt, "0"), ...own)),
  ]);
  const lines = rows.map(r => `• ${tgEscape(r.name)} — <b>${fmtMoney(r.debt, currency)}</b>${agentId ? "" : ` · ${tgEscape(shortName(r.agent))}`}`);
  if (lines.length) lines.push("", `${T.wTotal[lang]}: <b>${fmtMoney(sum?.total, currency)}</b> · ${Number(sum?.count ?? 0)}`);
  return { text: card(`💰 ${T.hDebts[lang]}`, null, lines, T.wNoDebts[lang]), extra: agentId ? undefined : inlineKeyboard([[openButton(lang, "/reports?tab=debts")]]) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Визиты: по агентам для офиса, списком магазинов для агента.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function answerPlans(scope: Scope, now = new Date()): Promise<Reply> {
  const { tenantId, lang, agentId, currency } = scope;
  const db = getDb();
  const from = tashkentDayStart(now), to = tashkentDayStart(now, 1);
  const today = and(eq(dailyPlans.tenantId, tenantId), planBetween(from, to));

  if (agentId) {
    const rows = await db.select({ status: dailyPlans.status, shop: shops.name, address: shops.address, debt: shops.debt })
      .from(dailyPlans).innerJoin(shops, eq(shops.id, dailyPlans.shopId))
      .where(and(today, eq(dailyPlans.agentId, agentId))).orderBy(dailyPlans.id).limit(30);
    const mark: Record<string, string> = { visited: "✅", skipped: "⏭", planned: "⬜" };
    const lines = rows.map(r =>
      `${mark[r.status] ?? "⬜"} <b>${tgEscape(r.shop)}</b>${Number(r.debt) > 0 ? ` · 💰 ${fmtMoney(r.debt, currency)}` : ""}` +
      (r.address ? `\n   📍 ${tgEscape(r.address)}` : ""));
    const done = rows.filter(r => r.status === "visited").length;
    const sub = rows.length ? `${todayLabel(now)} · ${done} ${T.wOf[lang]} ${rows.length}` : todayLabel(now);
    return { text: card(`📍 ${T.hMyPlan[lang]}`, sub, lines, T.wNoPlans[lang]) };
  }

  const rows = await db.select({
    agent: users.name, total: sql<number>`count(*)`,
    // Статус визита — 'visited', как в схеме; стояло 'completed', и бот всегда отвечал «0 из N».
    done: sql<number>`sum(case when ${dailyPlans.status} = 'visited' then 1 else 0 end)`,
  })
    .from(dailyPlans).innerJoin(users, eq(users.id, dailyPlans.agentId))
    .where(today).groupBy(users.id, users.name).orderBy(users.name).limit(LIMIT + 4);
  const lines = rows.map(r => {
    const t = Number(r.total ?? 0), d = Number(r.done ?? 0);
    const bar = t ? ` (${Math.round((d / t) * 100)}%)` : "";
    return `• ${tgEscape(shortName(r.agent))} — <b>${d}</b> ${T.wOf[lang]} ${t}${bar}`;
  });
  return { text: card(`📍 ${T.hPlans[lang]}`, todayLabel(now), lines, T.wNoPlans[lang]), extra: inlineKeyboard([[openButton(lang, "/supervisor/plans")]]) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Поиск: товар — остаток и цена; магазин — долг и последний заказ.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function answerSearch(scope: Scope, query: string): Promise<Reply> {
  const { tenantId, lang, agentId, currency } = scope;
  const needle = query.trim();
  // Одна-две буквы совпадут почти со всем каталогом — это не поиск, а мусор.
  if (needle.length < 3) return { text: T.notUnderstood[lang] };
  const db = getDb();

  const [prods, shopRows] = await Promise.all([
    db.select({
      name: products.name, unit: products.unit, price: products.unitPrice,
      available: sql<number>`coalesce(sum(${warehouseStock.available}), 0)`,
    })
      .from(products)
      .leftJoin(warehouseStock, and(eq(warehouseStock.productId, products.id), onDefaultWarehouse(tenantId)))
      .where(and(eq(products.tenantId, tenantId), eq(products.status, "active"), like(products.name, `%${needle}%`)))
      .groupBy(products.id, products.name, products.unit, products.unitPrice)
      .limit(5),
    db.select({
      name: shops.name, debt: shops.debt, agent: users.name,
      lastOrder: sql<Date | null>`(select max(o.created_at) from orders o where o.shop_id = ${shops.id} and o.deleted_at is null)`,
    })
      .from(shops).leftJoin(users, eq(users.id, shops.agentId))
      .where(and(eq(shops.tenantId, tenantId), like(shops.name, `%${needle}%`), ...(agentId ? [eq(shops.agentId, agentId)] : [])))
      .limit(5),
  ]);

  if (prods.length === 0 && shopRows.length === 0) return { text: `${T.nothing[lang]}\n\n${T.notUnderstood[lang]}` };

  const parts: string[] = [];
  if (prods.length) {
    parts.push(card(`📦 ${T.hProduct[lang]}`, null, prods.map(r =>
      `• <b>${tgEscape(r.name)}</b> — ${T.wLeft[lang]} ${fmtQty(r.available)} ${tgEscape(r.unit)} · ${T.wPrice[lang]} ${fmtMoney(r.price, currency)}`)));
  }
  if (shopRows.length) {
    parts.push(card(`🏪 ${T.hShops[lang]}`, null, shopRows.map(r =>
      `• <b>${tgEscape(r.name)}</b> — 💰 ${fmtMoney(r.debt, currency)}\n   ${T.wLastOrder[lang]}: ${ddmm(r.lastOrder)}${agentId ? "" : ` · ${T.wAgent[lang]}: ${tgEscape(shortName(r.agent))}`}`)));
  }
  return { text: parts.join("\n\n") };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Сотрудники: кто подключён к боту.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function answerStaff(scope: Scope): Promise<Reply> {
  const { tenantId, lang } = scope;
  const rows = await getDb().select({
    name: users.name, role: users.role,
    connected: sql<number>`CASE WHEN ${users.telegramChatId} IS NULL THEN 0 ELSE 1 END`,
  })
    .from(users).where(and(eq(users.tenantId, tenantId), eq(users.status, "active")))
    .orderBy(users.name).limit(40);

  if (rows.length === 0) return { text: card(`👥 ${T.hStaff[lang]}`, null, [], T.wNoStaff[lang]) };
  const on = rows.filter(r => Number(r.connected) === 1);
  const off = rows.filter(r => Number(r.connected) !== 1);
  const lines = [
    ...on.map(r => `✅ ${tgEscape(r.name)} — ${tgEscape(r.role)}`),
    ...(off.length ? [""] : []),
    ...off.map(r => `⚪ ${tgEscape(r.name)} — ${tgEscape(r.role)}`),
    ...(off.length ? ["", T.staffHint[lang]] : []),
  ];
  return { text: card(`👥 ${T.hStaff[lang]}`, `${on.length} ${T.wOf[lang]} ${rows.length}`, lines) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Утро: агенту — его день, руководителю — день команды.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function morningForAgent(scope: Scope, now = new Date()): Promise<string> {
  const { lang } = scope;
  const plan = await answerPlans(scope, now);
  return `☀️ <b>${T.hMorning[lang]}, ${tgEscape(scope.agentName ?? "")}</b>\n\n${plan.text}`;
}

export async function morningForTeam(scope: Scope, now = new Date()): Promise<Reply> {
  const { tenantId, lang } = scope;
  const db = getDb();
  const from = tashkentDayStart(now), to = tashkentDayStart(now, 1);
  const [[visits], [pending], [deliveries]] = await Promise.all([
    db.select({ total: sql<number>`count(*)`, agents: sql<number>`count(distinct ${dailyPlans.agentId})` })
      .from(dailyPlans).where(and(eq(dailyPlans.tenantId, tenantId), planBetween(from, to))),
    db.select({ count: sql<number>`count(*)` }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), eq(orders.status, "pending"))),
    db.select({ count: sql<number>`count(*)` }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), isNull(orders.deletedAt), inArray(orders.deliveryStatus, ["assigned", "out_for_delivery"]))),
  ]);
  const plans = await answerPlans(scope, now);
  const lines = [
    `📍 ${T.wVisits[lang]}: <b>${Number(visits?.total ?? 0)}</b> · ${Number(visits?.agents ?? 0)} 👤`,
    `🚚 ${T.wDeliveriesPlanned[lang]}: <b>${Number(deliveries?.count ?? 0)}</b>`,
    `⏳ ${T.wPending[lang]}: <b>${Number(pending?.count ?? 0)}</b>`,
  ];
  const head = card(`☀️ ${T.hMorning[lang]} · ${T.morningTeam[lang]}`, todayLabel(now), lines);
  const perAgent = plans.text.split("\n\n").slice(1).join("\n\n");
  return { text: perAgent ? `${head}\n\n${perAgent}` : head, extra: plans.extra };
}
