import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Разбор по ролям, второй круг: экраны руководителя и супервайзера.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * 1. В списке KPI колонка «Фрод» показывала красное «N (100%)» каждому, у кого
 *    за период нет точек GPS. Список визиты не разбирает — это делает
 *    карточка; красная цифра была приговором за выключенный телефон.
 * 2. Флаг mocked (телефон сообщил о подмене координат) писался в базу с
 *    первого дня и нигде не читался.
 * 3. Журнал аудита знал шесть действий из сорока, а кнопки отбора сравнивали
 *    «user» с «user.updated» точно — и отдавали пустоту.
 * 4. Приглашение предлагало superadmin, которого сервер отвергает; плитки
 *    «Активные/Неактивные» считались по странице в 25 строк.
 * 5. Экран слежения назывался тремя словами; кнопки «посещён/пропущен» были
 *    значками без подписи.
 */
vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Все *.ts под папкой, кроме проверок. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (entry !== "__tests__" && entry !== "node_modules") out.push(...sources(full));
    } else if (/\.ts$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

describe("KPI: нет GPS — не фрод", () => {
  const PAGE = read("src/pages/AgentKpi.tsx");
  const KPI = read("api/services/kpi.ts");

  it("список отдаёт число точек, а экран пишет «нет GPS» серым", () => {
    const list = KPI.slice(KPI.indexOf("export async function getAgentList"));
    expect(list, "getAgentList не отдаёт gpsPings").toMatch(/^\s+gpsPings,$/m);
    expect(PAGE).toContain('t("нет GPS", "GPS yo\'q")');
    // Красная цифра с процентом — то, что было.
    expect(PAGE).not.toContain("({a.fraudRate}%)");
  });

  it("плашка «Подозрительная активность» в списке снята, в карточке осталась", () => {
    expect(PAGE).not.toContain("suspiciousTotal");
    // Карточка разбирает визиты по-настоящему (anti-fraud) — там слово уместно.
    expect(PAGE).toContain("kpi.suspiciousVisits > 0 && (");
  });

  it("выбранный агент подъезжает к разбору", () => {
    expect(PAGE).toContain("scrollIntoView(");
  });

  it("хвосты «шт», «долг», «мин» — через t()", () => {
    for (const bad of ['} шт`', '" долг"', '} мин`']) {
      expect(PAGE, `русский хвост без перевода: ${bad}`).not.toContain(bad);
    }
  });
});

describe("подмена координат", () => {
  it("visitFlags: подменённая точка даёт одну строку у отмеченного визита", async () => {
    const { visitFlags } = await import("../services/visit-geo");
    const honest = { visited: true, closestM: 40, arrived: true, minutes: 20, trackLength: 30, mockedPings: 0 };
    expect(visitFlags(honest)).toEqual([]);
    const flags = visitFlags({ ...honest, mockedPings: 3 });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/подменены/);
    // У непосещённого — нечего подтверждать, нечего и оспаривать.
    expect(visitFlags({ ...honest, visited: false, mockedPings: 3 })).toEqual([]);
  });

  it("карта «где все сейчас» отдаёт mocked, панель красит его красным", () => {
    const router = read("api/agent-router.ts");
    const get = router.slice(router.indexOf("getLocations:"), router.indexOf("getTrail:"));
    expect(get).toContain("mocked: agentLocations.mocked");
    expect(read("src/components/tracking/agent-roster.ts")).toContain("mocked: p?.mocked === true");
    expect(read("src/components/tracking/AgentRail.tsx")).toContain('t("подмена координат", "koordinata almashtirilgan")');
  });
});

describe("журнал аудита", () => {
  const PAGE = read("src/pages/AuditLog.tsx");
  const configured = new Set([...PAGE.matchAll(/^\s+"([a-z_]+\.[a-z_.]+)":\s+\{ icon:/gm)].map(m => m[1]));

  it("каждое действие, которое пишет api, названо по-русски и по-узбекски", () => {
    const written = new Set<string>();
    for (const file of sources(path.resolve(process.cwd(), "api"))) {
      const src = read(file);
      if (!src.includes("recordAudit(")) continue;
      for (const m of src.matchAll(/action:\s*"([a-z_]+\.[a-z_.]+)"/g)) written.add(m[1]);
    }
    expect(written.size, "разбор не нашёл действий").toBeGreaterThan(30);
    const missing = [...written].filter(a => !configured.has(a));
    expect(missing, `в ACTION_CONFIG нет: ${missing.join(", ")}`).toEqual([]);
  });

  it("подписи двуязычные, «тенант» стал «организацией»", () => {
    expect(configured.size).toBeGreaterThan(30);
    expect(PAGE).not.toMatch(/Тенант|Tench/);
    for (const key of ["order", "payment", "shop"]) {
      expect(PAGE, `нет отбора «${key}»`).toContain(`{ key: "${key}",`);
    }
  });

  it("отбор словом ловит группу, точным именем — одно действие", async () => {
    const { actionCondition } = await import("../services/audit-log");
    expect(actionCondition("payment")).toMatchObject({ __kind: "like", val: "%payment%" });
    expect(actionCondition("order.cancelled")).toMatchObject({ __kind: "eq", val: "order.cancelled" });
    // Знаки шаблона LIKE из строки отбора не превращаются в «что угодно».
    expect(actionCondition("%_")).toMatchObject({ __kind: "like", val: "%%" });
  });
});

describe("пользователи", () => {
  it("в приглашении нет superadmin и второго ceo", () => {
    expect(read("src/pages/Users.tsx")).toContain('k !== "ceo" && k !== "superadmin"');
  });

  it("активные считаются сервером по всему отбору, а не по странице", () => {
    expect(read("api/user-router.ts")).toContain("count(CASE WHEN ${users.status} = 'active' THEN 1 END)");
    const page = read("src/pages/Users.tsx");
    expect(page).toContain("active: data?.active ?? 0");
    expect(page).not.toContain('list.filter((u) => u.status === "active")');
  });
});

describe("супервайзер: мелочи", () => {
  it("кнопки «посещён/пропущен» подписаны", () => {
    const page = read("src/pages/SupervisorPlans.tsx");
    expect(page).toContain('t("Посещён", "Tashrif")');
    expect(page).toContain('t("Пропущен", "O\'tkazildi")');
  });

  it("экран слежения зовётся «Карта» везде", () => {
    expect(read("src/i18n/ru.ts")).toMatch(/tracking:\s+"Карта"/);
    expect(read("src/i18n/uz.ts")).toMatch(/tracking:\s+"Xarita"/);
    expect(read("src/components/Layout.tsx")).toMatch(/"\/supervisor":\s+\{ title: \{ ru: "Карта"/);
    expect(read("src/pages/SupervisorTracking.tsx")).toContain('t("Карта", "Xarita")');
  });
});

describe("главная: довезено сегодня", () => {
  it("плитка показывает «N из M» из kpis", () => {
    const page = read("src/pages/Dashboard.tsx");
    expect(page).toContain("kpis.deliveredToday");
    expect(page).toContain("kpis.deliveredToday + kpis.deliveryPending");
    // Донат больше не «за всё время».
    expect(page).toContain('t("Заказы в работе", "Ishdagi buyurtmalar")');
  });
});
