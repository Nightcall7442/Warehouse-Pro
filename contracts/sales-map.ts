/**
 * «Карта продаж»: где покупают, где пусто, куда отправить агента.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Директор видел выручку числом и списком магазинов, но не видел её на земле.
 * «Чиланзар просел» узнавали от агента, а «в Ёшлике шесть точек перестали
 * брать» — никак: список магазинов отсортирован по имени, а отчёты — по
 * деньгам, и молчащий магазин в них просто отсутствует.
 *
 * ── Что здесь ───────────────────────────────────────────────────────────────
 *
 * Сервер (services/sales-map.ts) собирает факты по каждому магазину — деньги
 * за период и за такой же период до него, были ли заказы, координаты, район,
 * агент, — а всё решение принимается здесь, чистыми функциями: состояние
 * магазина, к какому району он относится, что с районом и почему. Экран и
 * выгрузка берут те же слова, что и тесты.
 *
 * ── Деньги ──────────────────────────────────────────────────────────────────
 *
 * Выручка — по правилу отчётов: доставленные заказы периода минус возвраты,
 * проведённые в том же периоде (services/revenue-returns.ts). Сумма по всем
 * магазинам сходится с выручкой P&L за тот же период. Долг (shop-debt.ts) —
 * другое правило, и сюда он попадает только светофором магазина.
 */
import type { ShopLightReason } from "./shop-light";

export const SALES_MAP_RULES = {
  /**
   * «Перестал заказывать» — за период ни одного заказа, а за столько дней до
   * его начала заказы были. Дальше этого окна магазин уже не «перестал», а
   * «не заказывает»: возвращать его — другой разговор, чем вчерашнего клиента.
   */
  SILENT_LOOKBACK_DAYS: 90,
  /** Выручка района упала к прошлому периоду на столько процентов и больше — ехать. */
  DROP_SEND_PCT: 30,
  /** На столько и больше — присмотреться; вместе с замолчавшими магазинами — ехать. */
  DROP_WATCH_PCT: 15,
  /** Заказывает меньше этой доли магазинов района — «здесь покупают мало». */
  LOW_COVERAGE_PCT: 30,
  /** …если магазинов в районе хотя бы столько: в районе из двух точек доля ничего не значит. */
  LOW_COVERAGE_MIN_SHOPS: 3,
  /**
   * Квадрат сетки для магазинов без территории и без района, градусов.
   * 0,02° — около 2,2 км по широте и 1,7 км по долготе на широте Ташкента:
   * квартал-махалля, который агент обходит за полдня.
   */
  GRID_CELL_DEG: 0.02,
  /** Светофор считается только у стольких замолчавших (с самыми большими деньгами). */
  SILENT_LIGHTS_MAX: 300,
  /** Магазинов без координат в ответе — столько, по убыванию выручки; число — всегда полное. */
  NO_GPS_LIST_MAX: 50,
} as const;

export type SalesShopState = "buying" | "silent" | "idle";
export type SalesAreaKind = "territory" | "district" | "grid" | "none";
export type SalesAreaStatus = "send" | "watch" | "ok";

/** Светофор магазина в том виде, в каком он нужен карте (contracts/shop-light.ts). */
export interface SalesShopLight {
  color: "red" | "yellow" | "green";
  reasons: ShopLightReason[];
  daysSinceOrder: number | null;
}

/** Факты по одному магазину — всё, что сервер знает; решения — ниже. */
export interface SalesShopFacts {
  id: number;
  name: string;
  city: string | null;
  district: string | null;
  territoryId: number | null;
  territoryName: string | null;
  agentId: number | null;
  /** null — агента нет или он уволен: закреплённым такой магазин не считается. */
  agentName: string | null;
  lat: number | null;
  lng: number | null;
  /** Выручка за период по правилу отчётов. Может быть меньше нуля: только возвраты. */
  revenue: number;
  /** То же за предыдущий такой же промежуток. */
  prevRevenue: number;
  /** Заказов в периоде — любых, кроме отменённых и удалённых. */
  ordersInPeriod: number;
  /** Таких же заказов за SILENT_LOOKBACK_DAYS до начала периода. */
  ordersBefore: number;
  /** День последнего такого заказа в окне [начало окна; конец периода]. */
  lastOrderDay: string | null;
  /** Только у замолчавших — светофор (#155) и последняя причина «без заказа». */
  light?: SalesShopLight;
  lastNoOrder?: { reason: string; note: string | null; date: string } | null;
}

/** Рабочая зона агента (agent_territories). */
export interface TerritoryAgent { territoryId: number; agentId: number; agentName: string }

export interface SalesMapBase {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  shops: SalesShopFacts[];
  zones: TerritoryAgent[];
  /** Выручка магазинов, убранных в архив, — чтобы итог сходился с P&L. */
  outside: { revenue: number; prevRevenue: number };
}

export interface SalesMapFilter { agentId?: number; territoryId?: number }

// ── Даты ────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const dayNum = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/**
 * Предыдущий промежуток той же длины вплотную к выбранному и окно «до».
 *
 * Длина — в днях включительно: «с 1 по 30 сентября» — тридцать дней, и
 * прошлый промежуток — со 2 по 31 августа. Арифметика по строкам в UTC: у
 * сервера UTC, у организации +5, и «первое число» не должно уехать на день.
 */
export function previousPeriod(from: string, to: string): { prevFrom: string; prevTo: string; lookbackFrom: string; days: number } {
  const f = dayNum(from);
  const days = Math.max(1, dayNum(to) - f + 1);
  return {
    prevFrom: dayStr(f - days),
    prevTo: dayStr(f - 1),
    lookbackFrom: dayStr(f - SALES_MAP_RULES.SILENT_LOOKBACK_DAYS),
    days,
  };
}

// ── Магазин ─────────────────────────────────────────────────────────────────

/**
 * Заказывает / перестал / не заказывает.
 *
 * «Заказывает» — по заказам, а не по деньгам: заказ, который ещё везут, в
 * выручку периода не попал, но магазин не молчит, и отправлять к нему агента
 * незачем.
 */
export function shopStateOf(f: Pick<SalesShopFacts, "ordersInPeriod" | "ordersBefore">): SalesShopState {
  if (f.ordersInPeriod > 0) return "buying";
  if (f.ordersBefore > 0) return "silent";
  return "idle";
}

const hasGps = (f: Pick<SalesShopFacts, "lat" | "lng">) => f.lat != null && f.lng != null;

/** Район одним ключом: регистр и пробелы в справочнике пишут кто как. */
function norm(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return s === "" ? null : s;
}

/**
 * К какому району относится магазин.
 *
 * По порядку: территория (её завели нарочно и к ней привязаны агенты) →
 * район из карточки (с городом: «Марказ» есть в каждом городе) → квадрат
 * сетки по координатам → «без района». Сетка нужна организациям, которые не
 * ведут ни территорий, ни районов: без неё все их точки свалились бы в один
 * «район», и сказать «куда ехать» было бы нечем.
 */
export function areaKeyOf(f: Pick<SalesShopFacts, "territoryId" | "district" | "city" | "lat" | "lng">): { key: string; kind: SalesAreaKind } {
  if (f.territoryId != null) return { key: `t:${f.territoryId}`, kind: "territory" };
  const d = norm(f.district);
  if (d) return { key: `d:${norm(f.city) ?? ""}|${d}`, kind: "district" };
  if (f.lat != null && f.lng != null) {
    const cell = SALES_MAP_RULES.GRID_CELL_DEG;
    return { key: `g:${Math.floor(f.lat / cell)}:${Math.floor(f.lng / cell)}`, kind: "grid" };
  }
  return { key: "none", kind: "none" };
}

/** Размер кружка на карте: 0 — не заказывал в периоде, 1…4 — по выручке (корень: крупные не задавят остальных). */
export function sizeGrade(revenue: number, maxRevenue: number): number {
  if (!(revenue > 0) || !(maxRevenue > 0)) return 0;
  return 1 + Math.min(3, Math.floor(Math.sqrt(Math.min(1, revenue / maxRevenue)) * 4));
}

// ── Район ───────────────────────────────────────────────────────────────────

export type SalesAreaReason =
  | { code: "silent"; count: number; shops: number; lost: number }
  | { code: "drop"; pct: number; amount: number }
  | { code: "low_coverage"; buying: number; shops: number }
  | { code: "no_agent" }
  | { code: "growth"; pct: number }
  | { code: "steady"; buying: number; shops: number };

/** Изменение к прошлому периоду, целыми процентами; null — в прошлом не продавали. */
export function changePct(revenue: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((revenue - prev) / prev) * 100);
}

/**
 * Что с районом и почему — цвет и причины кодами с числами.
 *
 *  • ехать — выручка упала на DROP_SEND_PCT% и больше, или магазины замолчали
 *    и это уже видно в деньгах (падение от DROP_WATCH_PCT%);
 *  • присмотреться — замолчавшие есть, но деньги держатся; или падение от
 *    DROP_WATCH_PCT%; или заказывает меньше LOW_COVERAGE_PCT% точек; или за
 *    районом никто не закреплён;
 *  • всё идёт — иначе.
 *
 * Падение считается от неокруглённых денег: 29,6% — ещё не 30.
 */
export function areaVerdict(a: {
  shops: number; buying: number; silent: number; revenue: number; prevRevenue: number; silentLost: number; agents: number;
}): { status: SalesAreaStatus; reasons: SalesAreaReason[] } {
  const R = SALES_MAP_RULES;
  const reasons: SalesAreaReason[] = [];
  const drop = a.prevRevenue > 0 ? ((a.prevRevenue - a.revenue) / a.prevRevenue) * 100 : 0;
  if (a.silent > 0) reasons.push({ code: "silent", count: a.silent, shops: a.shops, lost: Math.max(0, Math.round(a.silentLost)) });
  if (drop >= R.DROP_WATCH_PCT) reasons.push({ code: "drop", pct: Math.floor(drop), amount: Math.round(a.prevRevenue - a.revenue) });
  if (a.shops >= R.LOW_COVERAGE_MIN_SHOPS && a.buying * 100 < a.shops * R.LOW_COVERAGE_PCT) {
    reasons.push({ code: "low_coverage", buying: a.buying, shops: a.shops });
  }
  if (a.agents === 0 && a.shops > 0) reasons.push({ code: "no_agent" });

  if (drop >= R.DROP_SEND_PCT || (a.silent > 0 && drop >= R.DROP_WATCH_PCT)) return { status: "send", reasons };
  if (reasons.length > 0) return { status: "watch", reasons };
  const up = changePct(a.revenue, a.prevRevenue);
  if (up != null && up > 0) return { status: "ok", reasons: [{ code: "growth", pct: up }] };
  return { status: "ok", reasons: [{ code: "steady", buying: a.buying, shops: a.shops }] };
}

export interface SalesArea {
  key: string;
  kind: SalesAreaKind;
  /** Территория или район, как написано в справочнике; у сетки и «без района» — null. */
  name: string | null;
  city: string | null;
  /** Сетка: самый денежный магазин квадрата — по нему квадрат и называют. */
  anchor: string | null;
  territoryId: number | null;
  /** Район из карточки — для ссылки «магазины района». */
  district: string | null;
  shops: number;
  buying: number;
  silent: number;
  idle: number;
  noGps: number;
  revenue: number;
  prevRevenue: number;
  changePct: number | null;
  /** Выручка замолчавших магазинов в прошлом периоде. */
  silentLost: number;
  agents: Array<{ id: number; name: string; shops: number }>;
  /** Кого отправить по умолчанию: агент зоны, иначе тот, за кем больше точек района. */
  suggestedAgentId: number | null;
  status: SalesAreaStatus;
  reasons: SalesAreaReason[];
  /** [[юг, запад], [север, восток]] — для «показать на карте»; null — координат нет ни у кого. */
  bounds: [[number, number], [number, number]] | null;
  /** Замолчавшие магазины района — их и ставят в план визитов. */
  silentShopIds: number[];
  /** Не заказывающие — по желанию в тот же план («здесь покупают мало»). */
  idleShopIds: number[];
}

export interface SalesPoint {
  id: number;
  name: string;
  lat: number;
  lng: number;
  revenue: number;
  prevRevenue: number;
  state: SalesShopState;
  grade: number;
  areaKey: string;
  agentId: number | null;
  agentName: string | null;
  lastOrderDay: string | null;
}

export interface SilentShop {
  id: number;
  name: string;
  areaKey: string;
  agentId: number | null;
  agentName: string | null;
  prevRevenue: number;
  lastOrderDay: string | null;
  light: SalesShopLight | null;
  lastNoOrder: { reason: string; note: string | null; date: string } | null;
  hasGps: boolean;
}

export interface SalesMap {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  totals: {
    revenue: number; prevRevenue: number; changePct: number | null;
    shops: number; buying: number; silent: number; idle: number; noGps: number; silentLost: number;
  };
  /** Выручка магазинов в архиве — только без фильтров (их агента и территории уже не спросить). */
  outside: { revenue: number; prevRevenue: number } | null;
  areas: SalesArea[];
  points: SalesPoint[];
  silent: SilentShop[];
  noGps: Array<{ id: number; name: string; areaKey: string; revenue: number; state: SalesShopState }>;
}

const STATUS_RANK: Record<SalesAreaStatus, number> = { send: 0, watch: 1, ok: 2 };

/** Самое частое написание; при равенстве — с заглавной буквы («Чиланзар», а не «чиланзар»). */
function mostCommon(counts: Map<string, number>): string | null {
  const capital = (v: string) => (v[0] !== v[0].toLowerCase() ? 0 : 1);
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || capital(x[0]) - capital(y[0]) || x[0].localeCompare(y[0], "ru"))[0]?.[0] ?? null;
}

const money = (v: number) => Math.round(v);

/**
 * Отбор по агенту и территории.
 *
 * Магазины агента — закреплённые за ним и лежащие в его рабочих зонах
 * (agent_territories): у многих организаций закрепление ведут только зонами.
 */
export function filterShops(base: Pick<SalesMapBase, "shops" | "zones">, f: SalesMapFilter): SalesShopFacts[] {
  const zonesOf = f.agentId == null ? null
    : new Set(base.zones.filter(z => z.agentId === f.agentId).map(z => z.territoryId));
  return base.shops.filter(s =>
    (f.territoryId == null || s.territoryId === f.territoryId)
    && (zonesOf == null || s.agentId === f.agentId || (s.territoryId != null && zonesOf.has(s.territoryId))));
}

/** Карта целиком из фактов: районы, точки, замолчавшие, без координат, итоги. */
export function buildSalesMap(base: SalesMapBase, f: SalesMapFilter = {}): SalesMap {
  const shops = filterShops(base, f);
  const zoneAgents = new Map<number, TerritoryAgent[]>();
  for (const z of base.zones) zoneAgents.set(z.territoryId, [...(zoneAgents.get(z.territoryId) ?? []), z]);

  interface Acc {
    key: string; kind: SalesAreaKind; territoryId: number | null; territoryName: string | null;
    city: string | null; districts: Map<string, number>; list: SalesShopFacts[];
  }
  const acc = new Map<string, Acc>();
  const areaOfShop = new Map<number, string>();
  for (const s of shops) {
    const { key, kind } = areaKeyOf(s);
    areaOfShop.set(s.id, key);
    let a = acc.get(key);
    if (!a) {
      a = { key, kind, territoryId: kind === "territory" ? s.territoryId : null, territoryName: s.territoryName, city: null, districts: new Map(), list: [] };
      acc.set(key, a);
    }
    a.list.push(s);
    const spelled = (s.district ?? "").replace(/\s+/g, " ").trim();
    if (spelled) a.districts.set(spelled, (a.districts.get(spelled) ?? 0) + 1);
  }

  const byMoney = (x: SalesShopFacts, y: SalesShopFacts) => y.revenue - x.revenue || y.prevRevenue - x.prevRevenue || x.name.localeCompare(y.name, "ru");

  const areas: SalesArea[] = [...acc.values()].map(a => {
    const states = a.list.map(s => shopStateOf(s));
    const silentShops = a.list.filter((_, i) => states[i] === "silent");
    const revenue = a.list.reduce((t, s) => t + s.revenue, 0);
    const prevRevenue = a.list.reduce((t, s) => t + s.prevRevenue, 0);
    const silentLost = silentShops.reduce((t, s) => t + Math.max(0, s.prevRevenue), 0);

    // Агенты района: закреплённые за его точками и, у территории, — её зона.
    const agentShops = new Map<number, { name: string; shops: number }>();
    for (const s of a.list) {
      if (s.agentId == null || s.agentName == null) continue;
      const cur = agentShops.get(s.agentId) ?? { name: s.agentName, shops: 0 };
      agentShops.set(s.agentId, { name: cur.name, shops: cur.shops + 1 });
    }
    const zone = a.territoryId != null ? zoneAgents.get(a.territoryId) ?? [] : [];
    for (const z of zone) if (!agentShops.has(z.agentId)) agentShops.set(z.agentId, { name: z.agentName, shops: 0 });
    const agents = [...agentShops.entries()]
      .map(([id, v]) => ({ id, name: v.name, shops: v.shops }))
      .sort((x, y) => y.shops - x.shops || x.name.localeCompare(y.name, "ru"));
    const zoneFirst = zone.map(z => z.agentId).sort((x, y) => (agentShops.get(y)?.shops ?? 0) - (agentShops.get(x)?.shops ?? 0));
    const suggestedAgentId = zoneFirst[0] ?? agents[0]?.id ?? null;

    const placed = a.list.filter(hasGps);
    const bounds: SalesArea["bounds"] = placed.length === 0 ? null : [
      [Math.min(...placed.map(s => s.lat!)), Math.min(...placed.map(s => s.lng!))],
      [Math.max(...placed.map(s => s.lat!)), Math.max(...placed.map(s => s.lng!))],
    ];

    const buying = states.filter(x => x === "buying").length;
    const verdict = areaVerdict({ shops: a.list.length, buying, silent: silentShops.length, revenue, prevRevenue, silentLost, agents: agents.length });
    const topDistrict = mostCommon(a.districts);
    const cities = new Map<string, number>();
    for (const s of a.list) {
      const c = (s.city ?? "").replace(/\s+/g, " ").trim();
      if (c) cities.set(c, (cities.get(c) ?? 0) + 1);
    }
    const city = mostCommon(cities);

    return {
      key: a.key,
      kind: a.kind,
      name: a.kind === "territory" ? (a.territoryName ?? `#${a.territoryId}`) : a.kind === "district" ? topDistrict : null,
      city,
      anchor: a.kind === "grid" ? [...a.list].sort(byMoney)[0]?.name ?? null : null,
      territoryId: a.territoryId,
      district: a.kind === "district" ? topDistrict : null,
      shops: a.list.length,
      buying,
      silent: silentShops.length,
      idle: states.filter(x => x === "idle").length,
      noGps: a.list.length - placed.length,
      revenue: money(revenue),
      prevRevenue: money(prevRevenue),
      changePct: changePct(revenue, prevRevenue),
      silentLost: money(silentLost),
      agents,
      suggestedAgentId,
      status: verdict.status,
      reasons: verdict.reasons,
      bounds,
      silentShopIds: [...silentShops].sort((x, y) => y.prevRevenue - x.prevRevenue || x.id - y.id).map(s => s.id),
      idleShopIds: a.list.filter((_, i) => states[i] === "idle").map(s => s.id).sort((x, y) => x - y),
    };
  }).sort((x, y) =>
    STATUS_RANK[x.status] - STATUS_RANK[y.status]
    || Math.max(0, y.prevRevenue - y.revenue) - Math.max(0, x.prevRevenue - x.revenue)
    || y.silent - x.silent
    || y.revenue - x.revenue
    || x.key.localeCompare(y.key));

  const maxRevenue = Math.max(0, ...shops.map(s => s.revenue));
  const points: SalesPoint[] = shops.filter(hasGps).map(s => {
    const state = shopStateOf(s);
    return {
      id: s.id, name: s.name, lat: s.lat!, lng: s.lng!,
      revenue: money(s.revenue), prevRevenue: money(s.prevRevenue),
      state, grade: state === "buying" ? sizeGrade(s.revenue, maxRevenue) : 0,
      areaKey: areaOfShop.get(s.id)!, agentId: s.agentId, agentName: s.agentName, lastOrderDay: s.lastOrderDay,
    };
  });

  const silent: SilentShop[] = shops.filter(s => shopStateOf(s) === "silent")
    .sort((x, y) => y.prevRevenue - x.prevRevenue || (x.lastOrderDay ?? "").localeCompare(y.lastOrderDay ?? "") || x.id - y.id)
    .map(s => ({
      id: s.id, name: s.name, areaKey: areaOfShop.get(s.id)!, agentId: s.agentId, agentName: s.agentName,
      prevRevenue: money(s.prevRevenue), lastOrderDay: s.lastOrderDay,
      light: s.light ?? null, lastNoOrder: s.lastNoOrder ?? null, hasGps: hasGps(s),
    }));

  const withoutGps = shops.filter(s => !hasGps(s));
  const noGps = [...withoutGps].sort(byMoney).slice(0, SALES_MAP_RULES.NO_GPS_LIST_MAX)
    .map(s => ({ id: s.id, name: s.name, areaKey: areaOfShop.get(s.id)!, revenue: money(s.revenue), state: shopStateOf(s) }));

  const revenue = shops.reduce((t, s) => t + s.revenue, 0);
  const prevRevenue = shops.reduce((t, s) => t + s.prevRevenue, 0);
  const filtered = f.agentId != null || f.territoryId != null;
  return {
    from: base.from, to: base.to, prevFrom: base.prevFrom, prevTo: base.prevTo,
    totals: {
      revenue: money(revenue), prevRevenue: money(prevRevenue), changePct: changePct(revenue, prevRevenue),
      shops: shops.length,
      buying: areas.reduce((t, a) => t + a.buying, 0),
      silent: silent.length,
      idle: areas.reduce((t, a) => t + a.idle, 0),
      noGps: withoutGps.length,
      silentLost: money(shops.filter(s => shopStateOf(s) === "silent").reduce((t, s) => t + Math.max(0, s.prevRevenue), 0)),
    },
    outside: filtered || (Math.round(base.outside.revenue) === 0 && Math.round(base.outside.prevRevenue) === 0) ? null
      : { revenue: money(base.outside.revenue), prevRevenue: money(base.outside.prevRevenue) },
    areas, points, silent, noGps,
  };
}

// ── Слова ───────────────────────────────────────────────────────────────────

type Money = (n: number) => string;

/** Название района для экрана и выгрузки. */
export function areaTitle(a: Pick<SalesArea, "kind" | "name" | "city" | "anchor">, lang: string): string {
  const uz = lang === "uz";
  if (a.kind === "territory") return a.name ?? "—";
  if (a.kind === "district") return a.city ? `${a.name}, ${a.city}` : (a.name ?? "—");
  if (a.kind === "grid") return uz ? `«${a.anchor ?? "—"}» atrofi` : `Квартал у «${a.anchor ?? "—"}»`;
  return uz ? "Hududi va koordinatasi yo'q" : "Без района и координат";
}

export function areaStatusLabel(s: SalesAreaStatus, lang: string): string {
  const uz = lang === "uz";
  if (s === "send") return uz ? "Agent yuborish" : "Отправить агента";
  if (s === "watch") return uz ? "E'tibor bering" : "Присмотреться";
  return uz ? "Hammasi joyida" : "Всё идёт";
}

export function shopStateLabel(s: SalesShopState, lang: string): string {
  const uz = lang === "uz";
  if (s === "buying") return uz ? "Buyurtma beradi" : "Заказывает";
  if (s === "silent") return uz ? "To'xtatgan" : "Перестал заказывать";
  return uz ? "Buyurtma bermaydi" : "Не заказывает";
}

/** Причина словами: «Перестали заказывать 4 из 12 — в прошлом периоде они дали 3 200 000 сум». */
export function areaReasonText(r: SalesAreaReason, lang: string, fmt: Money): string {
  const uz = lang === "uz";
  switch (r.code) {
    case "silent":
      return uz
        ? `${r.shops} tadan ${r.count} tasi buyurtmani to'xtatgan${r.lost > 0 ? ` — o'tgan davrda ${fmt(r.lost)} bergan` : ""}`
        : `Перестали заказывать ${r.count} из ${r.shops}${r.lost > 0 ? ` — в прошлом периоде дали ${fmt(r.lost)}` : ""}`;
    case "drop":
      return uz
        ? `Tushum o'tgan davrga nisbatan ${r.pct}% ga kamaydi (−${fmt(r.amount)})`
        : `Выручка упала на ${r.pct}% к прошлому периоду (−${fmt(r.amount)})`;
    case "low_coverage":
      return uz
        ? `${r.shops} ta do'kondan faqat ${r.buying} tasi buyurtma beradi`
        : `Заказывают только ${r.buying} из ${r.shops} магазинов`;
    case "no_agent":
      return uz ? "Hududga agent biriktirilmagan" : "За районом не закреплён агент";
    case "growth":
      return uz ? `Tushum ${r.pct}% ga o'sdi` : `Выручка выросла на ${r.pct}%`;
    case "steady":
      return uz ? `${r.shops} tadan ${r.buying} tasi buyurtma beradi` : `Заказывают ${r.buying} из ${r.shops}`;
  }
}
