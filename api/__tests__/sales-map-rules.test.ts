/**
 * «Карта продаж»: правила договора (contracts/sales-map.ts).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  • прошлый период — той же длины вплотную, окно «до» — 90 дней;
 *  • магазин: заказывает / перестал / не заказывает — по заказам, не по деньгам;
 *  • район: территория → район из карточки (с городом, без регистра) →
 *    квадрат сетки → «без района»;
 *  • вердикт района на границах: 30% падения — ехать, 29,9% — нет;
 *    замолчавшие + 15% — ехать, замолчавшие без падения — присмотреться;
 *    «заказывают меньше 30%» — от трёх магазинов; нет агента — присмотреться;
 *  • порядок районов «куда ехать первым», отбор по агенту с его зонами,
 *    точки — только с координатами, замолчавшие — по деньгам;
 *  • причины словами на обоих языках.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • `drop >= R.DROP_SEND_PCT` → `>` — падает «ровно 30%»;
 *  • в areaKeyOf район раньше территории — падает «территория главнее»;
 *  • shopStateOf по выручке вместо заказов — падает «заказ ещё везут»;
 *  • filterShops без зон агента — падает «агент: свои и зоны».
 */
import { describe, it, expect } from "vitest";
import {
  previousPeriod, shopStateOf, areaKeyOf, sizeGrade, areaVerdict, buildSalesMap, filterShops,
  areaReasonText, areaTitle, changePct, SALES_MAP_RULES,
  type SalesShopFacts, type SalesMapBase,
} from "@contracts/sales-map";

const fmt = (n: number) => `${n} сум`;

let seq = 0;
function shop(p: Partial<SalesShopFacts> = {}): SalesShopFacts {
  seq++;
  return {
    id: seq, name: `Магазин ${seq}`, city: "Ургенч", district: null, territoryId: null, territoryName: null,
    agentId: null, agentName: null, lat: null, lng: null,
    revenue: 0, prevRevenue: 0, ordersInPeriod: 0, ordersBefore: 0, lastOrderDay: null,
    ...p,
  };
}
const base = (shops: SalesShopFacts[], extra: Partial<SalesMapBase> = {}): SalesMapBase => ({
  from: "2099-09-01", to: "2099-09-30", prevFrom: "2099-08-02", prevTo: "2099-08-31",
  shops, zones: [], outside: { revenue: 0, prevRevenue: 0 }, ...extra,
});

describe("период", () => {
  it("прошлый — той же длины вплотную; окно «до» — 90 дней", () => {
    expect(previousPeriod("2099-09-01", "2099-09-30")).toEqual({ prevFrom: "2099-08-02", prevTo: "2099-08-31", lookbackFrom: "2099-06-03", days: 30 });
    expect(previousPeriod("2099-03-01", "2099-03-01")).toMatchObject({ prevFrom: "2099-02-28", prevTo: "2099-02-28", days: 1 });
    // Через новый год и високосный февраль.
    expect(previousPeriod("2100-01-01", "2100-01-07")).toMatchObject({ prevFrom: "2099-12-25", prevTo: "2099-12-31" });
    expect(previousPeriod("2096-03-01", "2096-03-31")).toMatchObject({ prevFrom: "2096-01-30", prevTo: "2096-02-29" });
  });
});

describe("магазин", () => {
  it("заказ ещё везут — заказывает, даже без денег в периоде", () => {
    expect(shopStateOf({ ordersInPeriod: 1, ordersBefore: 0 })).toBe("buying");
    expect(shopStateOf({ ordersInPeriod: 0, ordersBefore: 3 })).toBe("silent");
    expect(shopStateOf({ ordersInPeriod: 0, ordersBefore: 0 })).toBe("idle");
  });

  it("территория главнее района; район — с городом и без регистра; дальше сетка; иначе «без района»", () => {
    expect(areaKeyOf({ territoryId: 7, district: "Ёшлик", city: "Ургенч", lat: 41.5, lng: 60.6 })).toEqual({ key: "t:7", kind: "territory" });
    const a = areaKeyOf({ territoryId: null, district: "  ёшлик ", city: "Ургенч", lat: null, lng: null });
    const b = areaKeyOf({ territoryId: null, district: "Ёшлик", city: "ургенч", lat: null, lng: null });
    expect(a).toEqual(b);
    expect(a.kind).toBe("district");
    // «Марказ» есть в каждом городе — это разные районы.
    expect(areaKeyOf({ territoryId: null, district: "Марказ", city: "Хива", lat: null, lng: null }).key)
      .not.toBe(areaKeyOf({ territoryId: null, district: "Марказ", city: "Ургенч", lat: null, lng: null }).key);
    const g1 = areaKeyOf({ territoryId: null, district: " ", city: null, lat: 41.551, lng: 60.631 });
    const g2 = areaKeyOf({ territoryId: null, district: null, city: null, lat: 41.559, lng: 60.639 });
    const g3 = areaKeyOf({ territoryId: null, district: null, city: null, lat: 41.581, lng: 60.631 });
    expect(g1.kind).toBe("grid");
    expect(g1.key).toBe(g2.key);
    expect(g3.key).not.toBe(g1.key);
    expect(areaKeyOf({ territoryId: null, district: null, city: "Ургенч", lat: null, lng: null })).toEqual({ key: "none", kind: "none" });
  });

  it("размер кружка: 0 без денег, 4 у самого денежного, корень не даёт крупному задавить", () => {
    expect(sizeGrade(0, 100)).toBe(0);
    expect(sizeGrade(-5, 100)).toBe(0);
    expect(sizeGrade(100, 100)).toBe(4);
    expect(sizeGrade(1, 100)).toBe(1);
    expect(sizeGrade(25, 100)).toBe(3);
    expect(sizeGrade(10, 0)).toBe(0);
  });
});

describe("вердикт района", () => {
  const v = (p: Partial<Parameters<typeof areaVerdict>[0]>) =>
    areaVerdict({ shops: 10, buying: 8, silent: 0, revenue: 1000, prevRevenue: 1000, silentLost: 0, agents: 1, ...p });

  it("ровно 30% падения — ехать; 29,9% — только присмотреться", () => {
    expect(v({ revenue: 700, prevRevenue: 1000 })).toMatchObject({ status: "send", reasons: [{ code: "drop", pct: 30, amount: 300 }] });
    expect(v({ revenue: 701, prevRevenue: 1000 })).toMatchObject({ status: "watch", reasons: [{ code: "drop", pct: 29 }] });
  });

  it("замолчавшие и падение от 15% — ехать; замолчавшие при деньгах на месте — присмотреться", () => {
    expect(v({ silent: 2, silentLost: 400, revenue: 850, prevRevenue: 1000 }).status).toBe("send");
    expect(v({ silent: 2, silentLost: 400, revenue: 851, prevRevenue: 1000 }).status).toBe("watch");
    const quiet = v({ silent: 2, silentLost: 400 });
    expect(quiet.status).toBe("watch");
    expect(quiet.reasons).toEqual([{ code: "silent", count: 2, shops: 10, lost: 400 }]);
  });

  it("мало кто заказывает — от трёх магазинов и ниже 30%; нет агента — присмотреться", () => {
    expect(v({ shops: 10, buying: 2 }).reasons).toContainEqual({ code: "low_coverage", buying: 2, shops: 10 });
    expect(v({ shops: 10, buying: 3 }).status).toBe("ok");
    expect(v({ shops: 2, buying: 0, revenue: 0, prevRevenue: 0 }).reasons.map(r => r.code)).not.toContain("low_coverage");
    expect(v({ agents: 0 })).toEqual({ status: "watch", reasons: [{ code: "no_agent" }] });
  });

  it("всё идёт: рост — процентом, иначе — сколько заказывают", () => {
    expect(v({ revenue: 1200 })).toEqual({ status: "ok", reasons: [{ code: "growth", pct: 20 }] });
    expect(v({})).toEqual({ status: "ok", reasons: [{ code: "steady", buying: 8, shops: 10 }] });
    expect(changePct(500, 0)).toBeNull();
  });
});

describe("карта целиком", () => {
  const tz = { territoryId: 1, territoryName: "Юнусабад" };
  const shops = [
    // Территория: упала вдвое, один замолчал — ехать первым.
    shop({ ...tz, name: "Олтин", agentId: 10, agentName: "Азиз", lat: 41.30, lng: 69.28, revenue: 300, prevRevenue: 600, ordersInPeriod: 2, ordersBefore: 3 }),
    shop({ ...tz, name: "Барака", agentId: 10, agentName: "Азиз", lat: 41.31, lng: 69.29, revenue: 0, prevRevenue: 400, ordersInPeriod: 0, ordersBefore: 2, lastOrderDay: "2099-08-20" }),
    // Район из карточки: растёт.
    shop({ district: "Чиланзар", city: "Ташкент", name: "Файз", agentId: 11, agentName: "Бобур", lat: 41.27, lng: 69.20, revenue: 900, prevRevenue: 500, ordersInPeriod: 4 }),
    // Без координат, но в районе; замолчал с маленькими деньгами.
    shop({ district: "чиланзар ", city: "Ташкент", name: "Навруз", agentId: 11, agentName: "Бобур", revenue: 0, prevRevenue: 50, ordersBefore: 1 }),
    // Сетка, без агента, никогда не заказывал.
    shop({ name: "Умид", lat: 41.36, lng: 69.35 }),
  ];
  const zones = [{ territoryId: 1, agentId: 12, agentName: "Сардор" }];
  const m = buildSalesMap(base(shops, { zones, outside: { revenue: 70, prevRevenue: 0 } }));

  it("районы по порядку «куда ехать первым» с причинами и агентами", () => {
    expect(m.areas.map(a => [a.kind, a.name, a.status])).toEqual([
      ["territory", "Юнусабад", "send"],
      ["district", "Чиланзар", "watch"],
      ["grid", null, "watch"],
    ]);
    const [yun, chil, grid] = m.areas;
    expect(yun).toMatchObject({ shops: 2, buying: 1, silent: 1, idle: 0, revenue: 300, prevRevenue: 1000, changePct: -70, silentLost: 400, silentShopIds: [shops[1].id] });
    // Зона территории — первой в «кого отправить», даже без своих точек.
    expect(yun.suggestedAgentId).toBe(12);
    expect(yun.agents.map(a => [a.name, a.shops])).toEqual([["Азиз", 2], ["Сардор", 0]]);
    expect(chil).toMatchObject({ shops: 2, noGps: 1, city: "Ташкент", district: "Чиланзар", suggestedAgentId: 11 });
    expect(chil.reasons.map(r => r.code)).toEqual(["silent"]);
    expect(grid).toMatchObject({ anchor: "Умид", agents: [], idleShopIds: [shops[4].id] });
    expect(grid.reasons.map(r => r.code)).toEqual(["no_agent"]);
    expect(yun.bounds).toEqual([[41.30, 69.28], [41.31, 69.29]]);
  });

  it("точки — только с координатами; замолчавшие — по деньгам; итоги и архив", () => {
    expect(m.points.map(p => p.name).sort()).toEqual(["Барака", "Олтин", "Умид", "Файз"]);
    expect(m.points.find(p => p.name === "Файз")).toMatchObject({ state: "buying", grade: 4 });
    expect(m.points.find(p => p.name === "Барака")).toMatchObject({ state: "silent", grade: 0 });
    expect(m.silent.map(s => s.name)).toEqual(["Барака", "Навруз"]);
    expect(m.silent[1].hasGps).toBe(false);
    expect(m.noGps.map(s => s.name)).toEqual(["Навруз"]);
    expect(m.totals).toEqual({ revenue: 1200, prevRevenue: 1550, changePct: -23, shops: 5, buying: 2, silent: 2, idle: 1, noGps: 1, silentLost: 450 });
    expect(m.outside).toEqual({ revenue: 70, prevRevenue: 0 });
  });

  it("агент: свои магазины и магазины его зон; с отбором строки архива нет", () => {
    const b = base(shops, { zones, outside: { revenue: 70, prevRevenue: 0 } });
    expect(filterShops(b, { agentId: 12 }).map(s => s.name)).toEqual(["Олтин", "Барака"]);
    expect(filterShops(b, { agentId: 11 }).map(s => s.name)).toEqual(["Файз", "Навруз"]);
    expect(filterShops(b, { territoryId: 1, agentId: 11 })).toEqual([]);
    expect(buildSalesMap(b, { agentId: 11 }).outside).toBeNull();
  });

  it("причины и названия — словами на обоих языках", () => {
    const [yun, , grid] = m.areas;
    expect(yun.reasons.map(r => areaReasonText(r, "ru", fmt))).toEqual([
      "Перестали заказывать 1 из 2 — в прошлом периоде дали 400 сум",
      "Выручка упала на 70% к прошлому периоду (−700 сум)",
    ]);
    expect(areaReasonText({ code: "low_coverage", buying: 2, shops: 15 }, "uz", fmt)).toBe("15 ta do'kondan faqat 2 tasi buyurtma beradi");
    expect(areaTitle(grid, "ru")).toBe("Квартал у «Умид»");
    expect(areaTitle(m.areas[1], "ru")).toBe("Чиланзар, Ташкент");
    expect(areaTitle({ kind: "none", name: null, city: null, anchor: null }, "uz")).toBe("Hududi va koordinatasi yo'q");
  });

  it("пороги — одним местом", () => {
    expect(SALES_MAP_RULES).toMatchObject({ SILENT_LOOKBACK_DAYS: 90, DROP_SEND_PCT: 30, DROP_WATCH_PCT: 15, LOW_COVERAGE_PCT: 30 });
  });
});
