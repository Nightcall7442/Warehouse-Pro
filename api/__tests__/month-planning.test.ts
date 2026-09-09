import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Месяц ставится разом — и ставится один раз.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * План визита создавался на ОДИН день. Занять агента на месяц значило открыть
 * форму двадцать шесть раз подряд. Разворачивание расписания в планы
 * (generatePlans) существовало, но шло по одному плану за раз: на каждую пару
 * «магазин — день» отдельный SELECT «нет ли уже такого» и отдельный INSERT.
 * Сорок точек на месяц — это около тысячи семисот запросов в цикле; до конца
 * такое не доходит, а обрыв на середине оставляет половину месяца
 * расставленной без всякого следа о том, где граница.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * 1. Календарная арифметика: границы месяца (включая февраль високосного),
 *    дни недели считаются в UTC — местное время браузера и сервера съехало бы
 *    на день, и «первое октября» стало бы тридцатым сентября.
 * 2. Повторный запуск ничего не удваивает и ничего не переписывает.
 * 3. Расстановка идёт пачками, а не строкой за строкой.
 * 4. Потолок за один запуск: отказ с числом, а не молчаливая обрезка.
 */
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  MAX_PLANS_PER_RUN, createVisitPlans, daysBetween, daysOnWeekdays, monthBounds, weekdayOf,
} from "../services/visit-planning";

describe("календарь месяца", () => {
  it("границы и число дней", () => {
    expect(monthBounds("2026-10")).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
    expect(monthBounds("2026-10").days).toHaveLength(31);
    expect(monthBounds("2026-11").days).toHaveLength(30);
  });

  it("февраль високосного года — 29 дней", () => {
    // 2028 високосный, 2026 нет. Таблицы длин месяцев в коде нет нарочно.
    expect(monthBounds("2028-02").days).toHaveLength(29);
    expect(monthBounds("2026-02").end).toBe("2026-02-28");
  });

  it("мусор вместо месяца — отказ, а не пустой месяц", () => {
    expect(() => monthBounds("октябрь")).toThrow();
    expect(() => monthBounds("2026-13")).toThrow();
  });

  it("день недели считается в UTC", () => {
    /*
      1 октября 2026 — четверг. Возьми код местное время (Ташкент +5, сервер
      UTC), полночь съехала бы на соседние сутки, и «четверги месяца» начались
      бы со среды. Проверка привязана к календарю, а не к зоне машины.
    */
    expect(weekdayOf("2026-10-01")).toBe(4);
    expect(weekdayOf("2026-10-04")).toBe(0); // воскресенье
  });

  it("дни недели отбираются по всему месяцу", () => {
    const { days } = monthBounds("2026-10");
    const mondays = daysOnWeekdays(days, [1]);
    expect(mondays).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    // Октябрь 2026: понедельников 4, сред 4, пятниц 5.
    expect(daysOnWeekdays(days, [1, 3, 5])).toHaveLength(13);
  });

  it("промежуток дат: включительно с обоих концов, наоборот — пусто", () => {
    expect(daysBetween("2026-10-30", "2026-11-02"))
      .toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysBetween("2026-10-05", "2026-10-01")).toEqual([]);
  });
});

// ── Стенд базы: помнит, что вставили, и что уже лежало ───────────────────────
function makeDb(existing: Array<{ agentId: number; shopId: number; day: string }> = []) {
  const inserts: Array<Record<string, unknown>[]> = [];
  return {
    inserts,
    db: {
      select: () => ({
        from: () => ({ where: () => Promise.resolve(existing) }),
      }),
      insert: () => ({
        values: (rows: Record<string, unknown>[]) => {
          inserts.push(rows);
          return Promise.resolve([{ insertId: 1 }]);
        },
      }),
    } as never,
  };
}

describe("расстановка визитов", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ставит каждую точку на каждый день", async () => {
    const { db, inserts } = makeDb();
    const r = await createVisitPlans(db, {
      tenantId: 1, createdBy: 9,
      pairs: [{ agentId: 5, shopId: 100 }, { agentId: 5, shopId: 101 }],
      days: ["2026-10-05", "2026-10-12"],
    });
    expect(r).toEqual({ created: 4, skipped: 0 });
    const rows = inserts.flat();
    expect(rows).toHaveLength(4);
    // Дата уходит в базу тем же днём, что и просили: DATE-колонка времени не
    // хранит, и сдвиг зоны здесь превратился бы в визит соседних суток.
    expect((rows[0].planDate as Date).toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(rows.every(x => x.status === "planned" && x.tenantId === 1 && x.createdBy === 9)).toBe(true);
  });

  it("повтор ничего не удваивает", async () => {
    // Ровно то, что даёт вторая расстановка того же месяца: половина уже стоит.
    const { db, inserts } = makeDb([
      { agentId: 5, shopId: 100, day: "2026-10-05" },
      { agentId: 5, shopId: 101, day: "2026-10-05" },
    ]);
    const r = await createVisitPlans(db, {
      tenantId: 1, createdBy: 9,
      pairs: [{ agentId: 5, shopId: 100 }, { agentId: 5, shopId: 101 }],
      days: ["2026-10-05", "2026-10-12"],
    });
    expect(r).toEqual({ created: 2, skipped: 2 });
    expect(inserts.flat().every(x => (x.planDate as Date).toISOString().startsWith("2026-10-12"))).toBe(true);
  });

  it("вставка идёт пачками, а не строкой за строкой", async () => {
    /*
      Здесь и была причина обрыва: тысяча визитов — тысяча отдельных запросов.
      Пятьсот строк на пачку; 600 визитов должны уложиться в два запроса, а не
      в шестьсот.
    */
    const { db, inserts } = makeDb();
    const pairs = Array.from({ length: 60 }, (_, i) => ({ agentId: 5, shopId: 200 + i }));
    const days = daysOnWeekdays(monthBounds("2026-10").days, [1, 3, 5]); // 13 дней
    const r = await createVisitPlans(db, { tenantId: 1, createdBy: 9, pairs, days });
    expect(r.created).toBe(780);
    expect(inserts.map(chunk => chunk.length)).toEqual([500, 280]);
  });

  it("выше потолка — отказ с числом, а не тихая обрезка", async () => {
    const { db, inserts } = makeDb();
    const pairs = Array.from({ length: 300 }, (_, i) => ({ agentId: 5, shopId: i + 1 }));
    await expect(createVisitPlans(db, {
      tenantId: 1, createdBy: 9, pairs, days: monthBounds("2026-10").days,
    })).rejects.toThrow(String(MAX_PLANS_PER_RUN));
    // Половины месяца в базе тоже не должно остаться.
    expect(inserts).toHaveLength(0);
  });

  it("пустой вход — пустой ответ, без запроса в базу", async () => {
    const { db, inserts } = makeDb();
    expect(await createVisitPlans(db, { tenantId: 1, createdBy: 9, pairs: [], days: ["2026-10-05"] }))
      .toEqual({ created: 0, skipped: 0 });
    expect(inserts).toHaveLength(0);
  });
});

// ── Разбор исходников: то, что стендом не поймать ────────────────────────────
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("месячные ручки на месте и закрыты по организации", () => {
  const SRC = read("api/schedule-router.ts");

  it("три процедуры месяца объявлены для директора и супервайзера", () => {
    for (const proc of ["monthOverview", "planMonth", "clearMonth"]) {
      expect(SRC, `нет процедуры ${proc}`).toMatch(new RegExp(`^  ${proc}: supervisorQuery`, "m"));
    }
  });

  it("сотрудник и магазины сверяются с организацией", () => {
    // Иначе месяц расставится на чужую точку: tenant_id пишется свой, а
    // agent_id и shop_id приходят из входа как есть.
    expect(SRC).toContain("await requireAgent(db, tenantId, input.agentId)");
    expect(SRC).toMatch(/eq\(shops\.tenantId, tenantId\)/);
    expect(SRC).toMatch(/inArray\(shops\.id, \[\.\.\.new Set\(ids\)\]\), eq\(shops\.tenantId, tenantId\)/);
  });

  it("очистка месяца не трогает отмеченные визиты", () => {
    /*
      «Очистить месяц» обязано убирать только запланированное. Посещения и
      отказы — это уже история работы агента, и стирать её из-за ошибки в
      плане нельзя ни при каких условиях.
    */
    const at = SRC.indexOf("clearMonth:");
    const body = SRC.slice(at, SRC.indexOf("}),", at));
    expect(body).toContain('eq(dailyPlans.status, "planned")');
    expect(body).toContain("delete(dailyPlans)");
  });

  it("разворачивание расписания больше не ходит по одному плану", () => {
    const at = SRC.indexOf("generatePlans:");
    const body = SRC.slice(at, SRC.indexOf("МЕСЯЦ РАЗОМ"));
    expect(body, "вернулась вставка по одной строке").not.toContain("insert(dailyPlans)");
    expect(body).toContain("createVisitPlans(db,");
  });
});

describe("нормы ставит тот, кому открыт экран", () => {
  const ST = read("api/sales-target-router.ts");

  it("подсказка по истории доступна супервайзеру", () => {
    // Ставит нормы супервайзер (upsert/bulkUpsert), а подсказка была уровня
    // оператора — кнопка на его экране отвечала бы отказом.
    expect(ST).toMatch(/^ {2}autoSuggest: managementQuery/m);
    expect(ST).toMatch(/^ {2}bulkUpsert: supervisorQuery/m);
  });

  it("норму нельзя поставить чужому сотруднику", () => {
    expect(ST).toContain("await requireOwnUsers(db, ctx.tenant.id, [input.userId])");
    expect(ST).toContain("await requireOwnUsers(db, ctx.tenant.id, input.targets.map(t => t.userId))");
  });
});

describe("экран планирования доступен обоим начальникам", () => {
  const APP = read("src/App.tsx");
  const NAV = read("src/const.ts");
  const PAGE = read("src/pages/SupervisorPlans.tsx");

  it("маршрут открыт директору и супервайзеру", () => {
    const at = APP.indexOf('path="/supervisor/plans"');
    expect(at).toBeGreaterThan(0);
    const guard = APP.slice(at, APP.indexOf("/>", at));
    expect(guard).toContain('"ceo"');
    expect(guard).toContain('"supervisor"');
  });

  it("у директора есть ссылка, а не только маршрут", () => {
    /*
      Здесь и была тупиковая роль: RoleGuard пускал ceo, а пункта меню не было
      ни в боковом, ни в нижнем — попасть на своё же планирование директор мог
      только набрав адрес руками.
    */
    const ceo = NAV.slice(NAV.indexOf("  ceo: ["), NAV.indexOf("],", NAV.indexOf("  ceo: [")));
    expect(ceo, "директору снова некуда нажать").toContain('path: "/supervisor/plans"');
  });

  it("страница зовёт месячные ручки", () => {
    const MONTH = read("src/components/plans/MonthPlanner.tsx");
    const NORMS = read("src/components/plans/MonthNorms.tsx");
    expect(PAGE).toContain("<MonthPlanner");
    expect(PAGE).toContain("<MonthNorms");
    expect(MONTH).toContain("trpc.schedule.planMonth.useMutation");
    expect(MONTH).toContain("trpc.schedule.monthOverview.useQuery");
    expect(MONTH).toContain("trpc.schedule.clearMonth.useMutation");
    expect(NORMS).toContain("trpc.salesTarget.bulkUpsert.useMutation");
    expect(NORMS).toContain("trpc.salesTarget.autoSuggest.useQuery");
  });

  it("месяц считается на экране тем же способом, что на сервере", () => {
    // Иначе предпросмотр «40 точек × 14 дней» разойдётся с тем, что встанет.
    const M = read("src/components/plans/month.ts");
    expect(M).toContain("Date.UTC");
    expect(M).toContain("T00:00:00Z");
  });
});
