import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { agentLocations, deliveryEvents, orders, settings, shops, tenants } from "@db/schema";
import { businessDay, businessToday } from "@contracts/business-time";
import { haversineKm } from "@contracts/geo";
import { coordsOf } from "@contracts/route-order";
import { env } from "../lib/env";
import { appLink } from "../lib/telegram";
import { dueBy, inRunConditions } from "./dispatch-board";
import { receiptToken } from "./receipt";
import type { Db } from "./order-shared";

/*
  Где мой заказ — страница для магазина по ссылке.

  ── Зачем ───────────────────────────────────────────────────────────────────

  Магазин звонил агенту: «когда привезут?». Агент звонил курьеру, курьер —
  за рулём. Теперь агент или офис отправляет магазину ссылку (кнопка «Ссылка
  для магазина» в карточке заказа), и магазин сам видит: принят, у курьера,
  в пути — перед вами столько-то адресов, примерно через столько-то минут, —
  доставлен.

  ── Что на странице НЕТ ─────────────────────────────────────────────────────

  Страница публичная — открыть её может любой, кому переслали ссылку. Поэтому:
   • курьер не назван вовсе: ни фамилии, ни телефона, ни имени. Имя
     сотрудника хранится одной строкой, обычно «Фамилия Имя», и угадать в
     ней имя нельзя — первым словом на страницу уходила фамилия;
   • координат нет ни в каком виде: ни курьера, ни магазина. Минуты
     считаются на сервере, наружу уходит только число;
   • сумм, товаров и долга нет — это не чек (чек — /r/…, своя подпись).
     Доставленному — ссылка на чек: там магазин подтверждает получение
     («всё пришло» / «есть вопрос»), и ссылка слежения — та же дверь, что
     QR на бумажной накладной;
   • отменённый, удалённый, ждущий подтверждения заказ, заказ
     приостановленной организации и доставленный больше трёх дней назад —
     «ссылки нет», как будто её и не было.

  ── Метка ───────────────────────────────────────────────────────────────────

  Номер заказа и HMAC от секрета приложения с приставкой «track:» — не той,
  что у чека («receipt:»): метку чека нельзя подставить сюда и наоборот.
*/

type Lang = "ru" | "uz";

/** Сколько дней после доставки ссылка ещё открывается. */
export const TRACK_VISIBLE_DAYS = 3;
/** Средняя скорость в городе и время на одну остановку — для «примерно через». */
const CITY_KMH = 25;
const STOP_MINUTES = 10;
/** Точка курьера старше этого — не знаем, где он: минут не обещаем. */
const PING_FRESH_MS = 30 * 60_000;

const sig = (orderId: number) => createHmac("sha256", env.appSecret).update(`track:${orderId}`).digest("base64url").slice(0, 22);

export function trackToken(orderId: number): string {
  return `${orderId}.${sig(orderId)}`;
}

export function parseTrackToken(token: string): number | null {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  const a = Buffer.from(m[2]), b = Buffer.from(sig(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export const trackingUrl = (orderId: number) => appLink(`/t/${trackToken(orderId)}`);

/** Заказ, по которому ссылку давать бессмысленно: его не повезут. */
export function trackHidden(o: { status: string; deletedAt: Date | null; deliveredAt: Date | null; deliveryStatus: string | null }, now: number): boolean {
  if (o.deletedAt) return true;
  if (o.status === "pending" || o.status === "cancelled" || o.status === "returned") return true;
  if (o.deliveryStatus === "delivered" || o.status === "delivered") {
    if (!o.deliveredAt) return true;
    return now - new Date(o.deliveredAt).getTime() > TRACK_VISIBLE_DAYS * 86_400_000;
  }
  return false;
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

const T = {
  title: { ru: "Заказ", uz: "Buyurtma" },
  steps: {
    ru: ["Принят", "У курьера", "В пути", "Доставлен"],
    uz: ["Qabul qilindi", "Kuryerda", "Yo'lda", "Yetkazildi"],
  },
  delivered: { ru: "Доставлен", uz: "Yetkazildi" },
  onWay: { ru: "Курьер едет к вам", uz: "Kuryer sizga yo'lda" },
  today: { ru: "Заказ у курьера, доставка сегодня", uz: "Buyurtma kuryerda, bugun yetkaziladi" },
  planned: { ru: (d: string) => `Доставка запланирована на ${d}`, uz: (d: string) => `Yetkazish ${d} ga rejalashtirilgan` },
  /*
    Срыв — без обещаний. Здесь стояло «поставщик свяжется с вами», и так —
    на каждом открытии, хоть через неделю, а звонить магазину никто не
    напоминает. «Сегодня» — только в день срыва; перенесённый заказ сюда не
    попадает: у него свой день («запланирована на»).
  */
  failedToday: { ru: "Сегодня доставить не получилось. Новый день доставки уточняется", uz: "Bugun yetkazib bo'lmadi. Yangi yetkazish kuni aniqlanmoqda" },
  failed: { ru: "Доставка не состоялась. Новый день доставки уточняется", uz: "Yetkazish amalga oshmadi. Yangi yetkazish kuni aniqlanmoqda" },
  receipt: { ru: "Накладная и подтверждение получения", uz: "Yuk xati va qabul qilganini tasdiqlash" },
  accepted: { ru: "Заказ принят и готовится к отправке", uz: "Buyurtma qabul qilindi va jo'natishga tayyorlanmoqda" },
  ahead: { ru: (n: number) => `Перед вами адресов: ${n}`, uz: (n: number) => `Sizdan oldin manzillar: ${n}` },
  eta: { ru: (m: number) => `Примерно через ${m} мин`, uz: (m: number) => `Taxminan ${m} daqiqadan keyin` },
  phone: { ru: "Вопросы по заказу", uz: "Buyurtma bo'yicha savollar" },
  refresh: { ru: "Страница обновляется сама раз в минуту", uz: "Sahifa har daqiqada o'zi yangilanadi" },
  missing: {
    ru: { h: "Ссылка не работает", p: "Заказ не найден, уже давно доставлен или отменён. Уточните у поставщика." },
    uz: { h: "Havola ishlamaydi", p: "Buyurtma topilmadi, ancha oldin yetkazilgan yoki bekor qilingan. Yetkazib beruvchidan so'rang." },
  },
};

const fmtDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const fmtTime = (d: Date) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

/** Язык страницы: ?lang=, иначе заголовок браузера; по умолчанию русский. */
export function trackLang(query: string | undefined, acceptLanguage: string | undefined): Lang {
  if (query === "uz" || query === "ru") return query;
  return acceptLanguage?.trim().toLowerCase().startsWith("uz") ? "uz" : "ru";
}

function page(lang: Lang, title: string, body: string, refresh: boolean): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${refresh ? `<meta http-equiv="refresh" content="60">` : ""}<title>${esc(title)}</title>
<style>
  body { margin: 0; background: #f2f1ed; color: #1b1b1b; font-family: "Manrope", "Segoe UI", system-ui, sans-serif; }
  .w { max-width: 440px; margin: 0 auto; padding: 20px 16px 32px; }
  .lang { text-align: right; font-size: 13px; }
  .lang a { color: #555; margin-left: 10px; text-decoration: none; }
  .lang a.on { color: #1b1b1b; font-weight: 700; }
  .card { background: #fff; border-radius: 14px; padding: 18px; margin-top: 12px; box-shadow: 0 1px 6px rgba(0,0,0,.06); }
  .co { font-size: 13px; color: #666; }
  h1 { font-size: 20px; margin: 4px 0 0; }
  .st { font-size: 17px; font-weight: 700; margin-top: 14px; }
  .sub { font-size: 14px; color: #444; margin-top: 6px; }
  ol { list-style: none; padding: 0; margin: 16px 0 0; display: flex; gap: 6px; }
  ol li { flex: 1; font-size: 11px; color: #888; border-top: 4px solid #ddd; padding-top: 6px; }
  ol li.on { color: #1f7a4d; border-color: #1f7a4d; font-weight: 700; }
  .ph { font-size: 14px; margin-top: 14px; }
  .ph a { color: #1f5fa8; }
  .f { font-size: 12px; color: #777; text-align: center; margin-top: 14px; }
</style></head><body><div class="w">${body}</div></body></html>`;
}

function missingPage(lang: Lang): { status: number; html: string } {
  const m = T.missing[lang];
  return { status: 404, html: page(lang, m.h, `<div class="card"><h1>${esc(m.h)}</h1><p class="sub">${esc(m.p)}</p></div>`, false) };
}

export async function trackingPage(db: Db, token: string, lang: Lang, now: number = Date.now()): Promise<{ status: number; html: string }> {
  const id = parseTrackToken(token);
  if (!id) return missingPage(lang);

  const [o] = await db.select({
    id: orders.id, tenantId: orders.tenantId, number: orders.orderNumber, status: orders.status,
    deliveryStatus: orders.deliveryStatus, deliveredAt: orders.deliveredAt, deletedAt: orders.deletedAt,
    courierId: orders.courierId, plannedDeliveryDate: orders.plannedDeliveryDate, routeSeq: orders.routeSeq,
    shopLat: shops.gpsLat, shopLng: shops.gpsLng, tenantStatus: tenants.status,
  }).from(orders)
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .leftJoin(shops, and(eq(shops.id, orders.shopId), eq(shops.tenantId, orders.tenantId)))
    .where(eq(orders.id, id))
    .limit(1);
  // Приостановленная организация — доступа у неё нет, и у ссылок её магазинам тоже.
  if (!o || o.tenantStatus !== "active" || trackHidden(o, now)) return missingPage(lang);

  const [cfg] = await db.select({ company: settings.companyName, phone: settings.companyPhone })
    .from(settings).where(eq(settings.tenantId, o.tenantId)).limit(1);
  const today = businessToday(now);

  let step = 0;
  let line: string;
  const extra: string[] = [];
  if (o.deliveryStatus === "delivered" || o.status === "delivered") {
    step = 3;
    line = `${T.delivered[lang]} ${o.deliveredAt ? fmtTime(new Date(o.deliveredAt)) : ""}`.trim();
  } else if (o.courierId && (o.deliveryStatus === "assigned" || o.deliveryStatus === "out_for_delivery")) {
    const planned = o.plannedDeliveryDate && o.plannedDeliveryDate > today ? o.plannedDeliveryDate : null;
    if (planned) {
      step = 1;
      line = T.planned[lang](fmtDay(planned));
    } else {
      step = o.deliveryStatus === "out_for_delivery" ? 2 : 1;
      line = step === 2 ? T.onWay[lang] : T.today[lang];
      const eta = await etaOf(db, o, today, now);
      if (eta.ahead > 0) extra.push(T.ahead[lang](eta.ahead));
      if (eta.minutes != null) extra.push(T.eta[lang](eta.minutes));
    }
  } else if (o.deliveryStatus === "failed") {
    const [last] = await db.select({ at: deliveryEvents.recordedAt }).from(deliveryEvents)
      .where(and(eq(deliveryEvents.tenantId, o.tenantId), eq(deliveryEvents.orderId, o.id), eq(deliveryEvents.kind, "failed")))
      .orderBy(desc(deliveryEvents.id))
      .limit(1);
    line = last?.at && businessDay(last.at) === today ? T.failedToday[lang] : T.failed[lang];
  } else {
    line = T.accepted[lang];
  }

  const steps = T.steps[lang].map((s, i) => `<li class="${i <= step ? "on" : ""}">${esc(s)}</li>`).join("");
  const body = `
  <div class="lang"><a class="${lang === "ru" ? "on" : ""}" href="?lang=ru">Рус</a><a class="${lang === "uz" ? "on" : ""}" href="?lang=uz">O'zb</a></div>
  <div class="card">
    <div class="co">${esc(cfg?.company ?? "")}</div>
    <h1>${esc(T.title[lang])} ${esc(o.number)}</h1>
    <ol>${steps}</ol>
    <div class="st">${esc(line)}</div>
    ${extra.map(x => `<div class="sub">${esc(x)}</div>`).join("")}
    ${step === 3 ? `<div class="ph"><a href="/r/${esc(receiptToken(o.id))}">${esc(T.receipt[lang])}</a></div>` : ""}
    ${cfg?.phone ? `<div class="ph">${esc(T.phone[lang])}: <a href="tel:${esc(cfg.phone.replace(/[^\d+]/g, ""))}">${esc(cfg.phone)}</a></div>` : ""}
  </div>
  ${step < 3 ? `<div class="f">${esc(T.refresh[lang])}</div>` : ""}`;
  return { status: 200, html: page(lang, `${T.title[lang]} ${o.number}`, body, step < 3) };
}

/**
 * Сколько адресов перед этим заказом у курьера сегодня и через сколько
 * примерно минут он приедет. Минуты — только при свежей точке курьера и
 * координатах магазина: иначе обещание было бы выдумкой.
 */
async function etaOf(
  db: Db,
  o: { id: number; tenantId: number; courierId: number | null; routeSeq: number | null; shopLat: string | null; shopLng: string | null },
  today: string, now: number,
): Promise<{ ahead: number; minutes: number | null }> {
  if (!o.courierId) return { ahead: 0, minutes: null };
  // Впереди — заказы с местом в маршруте раньше этого; у заказа без места
  // впереди все, у кого место есть.
  const before = o.routeSeq != null ? lt(orders.routeSeq, o.routeSeq) : isNotNull(orders.routeSeq);
  const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(orders)
    .where(and(...inRunConditions(o.tenantId), dueBy(today), eq(orders.courierId, o.courierId), ne(orders.id, o.id), before));
  const ahead = Number(n) || 0;

  const shop = coordsOf({ lat: o.shopLat, lng: o.shopLng });
  if (!shop) return { ahead, minutes: null };
  const [ping] = await db.select({ lat: agentLocations.lat, lng: agentLocations.lng }).from(agentLocations)
    .where(and(
      eq(agentLocations.tenantId, o.tenantId), eq(agentLocations.agentId, o.courierId),
      gte(agentLocations.createdAt, new Date(now - PING_FRESH_MS)),
    ))
    .orderBy(desc(agentLocations.createdAt))
    .limit(1);
  const here = coordsOf(ping);
  if (!here) return { ahead, minutes: null };
  const km = haversineKm(here.lat, here.lng, shop.lat, shop.lng);
  const raw = (km / CITY_KMH) * 60 + ahead * STOP_MINUTES;
  // Круглыми пятёрками и не меньше десяти: «через 3 минуты» звучит точнее, чем мы знаем.
  return { ahead, minutes: Math.max(10, Math.ceil(raw / 5) * 5) };
}
