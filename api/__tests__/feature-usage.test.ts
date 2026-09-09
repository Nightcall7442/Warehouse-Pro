import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Отчёт «кто чем пользуется» — перед тем, как включать проверку тарифов.
 *
 * ── Что за ним стоит ────────────────────────────────────────────────────────
 *
 * Тарифы продают GPS-контроль, обмен с 1С, полную аналитику и брендирование как
 * платные возможности. Код не проверяет ни одной: разграничены только чат
 * поддержки и доступ по API. За часть обещаний берут деньги, ничего не
 * разграничивая.
 *
 * Включить проверку одним движением нельзя: организации уже работают, и если
 * кто-то пользуется GPS на тарифе без него, включение отнимет функцию посреди
 * рабочего дня. Отчёт показывает, кого именно это затронет.
 *
 * ── Главное, что здесь проверяется ──────────────────────────────────────────
 *
 * Что в «сверх тарифа» попадает только ПРЯМОЙ след. Аналитика следов не
 * оставляет — читать отчёт значит ничего не записать, — и косвенный признак
 * (заполненная себестоимость) означает «похоже, собирались», а не
 * «пользуются». Спутать одно с другим значит отнять функцию по догадке.
 */

vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});

import {
  agentLocations, apiKeys, onecConfig, products, salesTargets,
  supportMessages, syncStatus, tenantBranding, tenants,
} from "@db/schema";

type Rows = Record<string, unknown>[];

/** Какую таблицу спрашивают. */
function nameOf(ref: unknown): string {
  if (ref === tenants) return "tenants";
  if (ref === agentLocations) return "gps";
  if (ref === onecConfig) return "onec";
  if (ref === syncStatus) return "sync";
  if (ref === tenantBranding) return "branding";
  if (ref === apiKeys) return "keys";
  if (ref === supportMessages) return "chat";
  if (ref === products) return "products";
  if (ref === salesTargets) return "targets";
  return "other";
}

/*
  Стенд отдаёт готовые строки по таблице.

  Условия он не разбирает намеренно: их правильность — вопрос к SQL, а здесь
  проверяется решение, которое принимается ПОСЛЕ запросов. Подсовывая нужные
  ответы, мы описываем «у этой организации 412 точек GPS», не воспроизводя
  MySQL.
*/
function makeDb(byTable: Record<string, Rows>) {
  const answer = (t: string) => Promise.resolve(byTable[t] ?? []);
  return {
    select: () => {
      let table = "other";
      const api: Record<string, unknown> = {
        from(ref: unknown) { table = nameOf(ref); return api; },
        where() { return api; },
        groupBy() { return answer(table); },
        orderBy() { return answer(table); },
        then(res: (v: Rows) => unknown) { return answer(table).then(res); },
      };
      return api;
    },
  };
}

let db: ReturnType<typeof makeDb>;
vi.mock("../queries/connection", () => ({ getDb: () => db }));

async function collect(byTable: Record<string, Rows>) {
  db = makeDb(byTable);
  const { collectFeatureUsage } = await import("../services/feature-usage");
  return collectFeatureUsage();
}

const ONE = [{ id: 1, name: "Serena Trade", plan: "basic" }];

describe("прямой след виден", () => {
  it("GPS на тарифе без GPS — сверх тарифа", async () => {
    const [row] = await collect({
      tenants: ONE,
      gps: [{ tenantId: 1, n: 412 }],
    });

    expect(row.overreach, "GPS на Basic не замечен").toContain("gps");
    const gps = row.traces.find(t => t.feature === "gps")!;
    expect(gps.used).toBe(true);
    expect(gps.allowed).toBe(false);
    expect(gps.evidence).toContain("412");
  });

  it("та же функция на тарифе, где она есть, — не нарушение", async () => {
    const [row] = await collect({
      tenants: [{ id: 1, name: "X", plan: "pro" }],
      gps: [{ tenantId: 1, n: 412 }],
    });
    expect(row.overreach).not.toContain("gps");
  });

  it("обмен с 1С считается настроенным, а не только ходившим", async () => {
    /*
      Настроенный, но ни разу не сработавший обмен — тоже использование: адрес,
      логин и пароль 1С вводили руками, и это ровно та работа, за которую берут
      деньги.
    */
    const [row] = await collect({
      tenants: ONE,
      onec: [{ tenantId: 1, n: 1 }],
    });
    const onec = row.traces.find(t => t.feature === "onec")!;
    expect(onec.used).toBe(true);
    expect(onec.evidence).toContain("успешных синхронизаций нет");
    expect(row.overreach).toContain("onec");
  });
});

describe("косвенный признак не считается использованием", () => {
  it("себестоимость и планы продаж не отнимают аналитику", async () => {
    /*
      Главная проверка файла. Чтение отчёта следов не оставляет, поэтому у
      аналитики стоит косвенный признак. Приняв его за доказательство, мы
      отняли бы функцию у того, кто просто заполнил себестоимость товаров.
    */
    const [row] = await collect({
      tenants: ONE,
      products: [{ tenantId: 1, n: 88 }],
      targets: [{ tenantId: 1, n: 4 }],
    });

    const an = row.traces.find(t => t.feature === "analytics")!;
    expect(an.indirect, "косвенный признак не отмечен").toBe(true);
    expect(an.used, "косвенный признак принят за прямой след").toBe(false);
    expect(row.overreach, "аналитику отняли по догадке").not.toContain("analytics");
  });

  it("без признаков сказано прямо, что следа нет", async () => {
    const [row] = await collect({ tenants: ONE });
    const an = row.traces.find(t => t.feature === "analytics")!;
    expect(an.evidence).toContain("следа нет");
  });
});

describe("что отчёт не путает", () => {
  it("чужие следы не приписываются", async () => {
    // Счётчики приходят сгруппированными по организации; перепутать их —
    // значит показать владельцу нарушение там, где его нет.
    const rows = await collect({
      tenants: [
        { id: 1, name: "A", plan: "basic" },
        { id: 2, name: "B", plan: "basic" },
      ],
      gps: [{ tenantId: 2, n: 10 }],
    });

    expect(rows.find(r => r.tenantId === 1)!.overreach).toEqual([]);
    expect(rows.find(r => r.tenantId === 2)!.overreach).toContain("gps");
  });

  it("на пробном периоде нарушений нет по определению", async () => {
    // Решение владельца: пробный показывает продукт целиком.
    const [row] = await collect({
      tenants: [{ id: 1, name: "T", plan: "trial" }],
      gps: [{ tenantId: 1, n: 5 }],
      onec: [{ tenantId: 1, n: 1 }],
      branding: [{ tenantId: 1, n: 1 }],
      keys: [{ tenantId: 1, n: 1 }],
      chat: [{ tenantId: 1, n: 3 }],
    });
    expect(row.overreach).toEqual([]);
  });
});

describe("отчёт виден суперадмину", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("ручка закрыта от всех, кроме платформы", () => {
    // Это данные обо всех организациях разом.
    expect(read("api/tenant-router.ts")).toMatch(/featureUsage:\s*superAdminQuery/);
  });

  it("стоит выше списка организаций", () => {
    /*
      Сначала отчёт поставили следом за списком, и владелец его не нашёл:
      список длинный, отчёт короткий, и чтобы дойти, надо пролистать всех
      арендаторов мимо. Раздел, который ждёт решения по каждой строке, не
      должен стоять за тем, что просто просматривают.
    */
    const page = read("src/pages/SuperAdmin.tsx");
    expect(page.indexOf("<FeatureUsage />")).toBeLessThan(page.indexOf("<TenantList"));
  });

  it("экран вызывает её и стоит на странице", () => {
    // Ручка без экрана — то же самое, что ручки нет: этой болезнью уже
    // болели погрузочные листы и вебхук бота.
    expect(read("src/components/superadmin/FeatureUsage.tsx")).toContain("tenant.featureUsage");
    expect(read("src/pages/SuperAdmin.tsx")).toContain("<FeatureUsage />");
  });
});
