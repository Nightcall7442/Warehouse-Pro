/**
 * Телеграм-бот для сотрудников организации: меню по ролям, события, адресаты.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Владелец: «бот не функциональный, не профессиональный, по визуалу — тоже».
 * Одно меню на всех, агенту — отказ «запросы доступны руководителям»; четыре
 * события, из них «просроченный долг» уходил ВСЕМ агентам организации;
 * настройки обещали «план визитов утром» и «изменение статуса заказа» — и не
 * слали ни того, ни другого; «Планы» считали визиты по статусу 'completed',
 * которого в схеме нет, и всегда отвечали «0 из N».
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · каждая кнопка каждого меню опознаётся и разрешена своей роли;
 *   · каждое событие: умолчание, подпись в настройках, ручка правил, схема,
 *     и есть место в коде, которое его шлёт;
 *   · agentOnly: долг уходит директору и агенту магазина, а не всем агентам;
 *   · пробный тариф — с ботом (решение владельца от 09.09.2026);
 *   · утренний крон стоит после конца тихих часов;
 *   · кнопки под сообщением обрабатываются и гасятся (answerCallbackQuery);
 *   · границы срока считаются по Ташкенту.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("../lib/env", () => ({ env: { appSecret: "тест", appUrl: "https://app.test", telegramBotToken: "", telegramWebhookSecret: "" } }));
vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { MENUS, detectIntent, detectPeriod, menuGroup } = await import("../telegram/texts");
const { INTENTS_BY_GROUP, PLANS_WITH_BOT } = await import("../telegram/bot");
const { DEFAULT_RULES, NOTIFY_EVENTS, QUIET_TO } = await import("../services/telegram-notify");
const { tgMessages, fmtMoney, fmtQty } = await import("../lib/telegram");
const { shortName, periodRange, tashkentDayStart, dayStr } = await import("../telegram/answers");

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

function apiSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(p); }
      else if (/\.ts$/.test(name)) out.push(p);
    }
  };
  walk(join(ROOT, "api"));
  return out;
}

beforeEach(() => vi.clearAllMocks());

describe("меню по ролям", () => {
  it("каждая кнопка каждого меню опознаётся и разрешена своей роли", () => {
    for (const group of ["manage", "agent", "courier"] as const) {
      for (const lang of ["ru", "uz"] as const) {
        for (const row of MENUS[group][lang]) for (const label of row) {
          const intent = detectIntent(label);
          expect(intent, `${group}/${lang}: «${label}» не опознаётся`).not.toBe("search");
          expect(INTENTS_BY_GROUP[group].has(intent), `${group}/${lang}: «${label}» → ${intent} не разрешён этой роли`).toBe(true);
        }
      }
    }
  });

  it("значок в кнопке не мешает разбору; срок понимается по-русски и по-узбекски", () => {
    expect(detectIntent("📊 Сводка")).toBe("summary");
    expect(detectIntent("💰 Qarzlar")).toBe("debts");
    expect(detectIntent("Мои заказы")).toBe("orders");
    expect(detectPeriod("сводка за вчера")).toBe("yesterday");
    expect(detectPeriod("hafta")).toBe("week");
    expect(detectPeriod("месяц")).toBe("month");
    expect(detectPeriod("📊 Сводка")).toBe("today");
  });

  it("агент видит своё, курьер — маршрут; числа организации — только офис", () => {
    expect(menuGroup("agent")).toBe("agent");
    expect(menuGroup("merchandiser")).toBe("agent");
    expect(menuGroup("courier")).toBe("courier");
    expect(menuGroup("ceo")).toBe("manage");
    expect(INTENTS_BY_GROUP.agent.has("agents")).toBe(false);
    expect(INTENTS_BY_GROUP.agent.has("deliveries")).toBe(false);
    expect(INTENTS_BY_GROUP.courier.has("summary")).toBe(false);
    expect(INTENTS_BY_GROUP.manage.has("agents")).toBe(true);
  });

  it("пробный тариф — с ботом", () => {
    expect(PLANS_WITH_BOT.has("trial")).toBe(true);
    expect(PLANS_WITH_BOT.has("basic")).toBe(false);
  });
});

describe("события: каждое обеспечено со всех сторон", () => {
  const rulesUi = read("src/components/settings/TelegramRules.tsx");
  const router = read("api/telegram-router.ts");
  const schema = read("db/schema.ts");
  const sources = apiSources().map(p => ({ p, text: read(p.slice(ROOT.length + 1)) }));

  it.each(NOTIFY_EVENTS)("%s", (event) => {
    expect(DEFAULT_RULES[event], "нет умолчания").toBeDefined();
    expect(rulesUi, "нет подписи в настройках").toContain(`"${event}"`);
    expect(router, "нет в ручке правил").toContain(`"${event}"`);
    expect(schema, "нет в перечислении схемы").toContain(`"${event}"`);
    const senders = sources.filter(s => !s.p.endsWith("telegram-notify.ts") && s.text.includes(`event: "${event}"`));
    expect(senders.length, `событие «${event}» никто не шлёт`).toBeGreaterThan(0);
  });

  it("правило по умолчанию не отдаёт личное в общий чат: закрытый заказ — только агенту", () => {
    expect(DEFAULT_RULES["order.delivered"]).toEqual(["agent"]);
  });
});

describe("кому уходит адресное агенту", () => {
  /** Выборки идут по порядку: организация → правила → сотрудники → группа. */
  function fakeDb(userRows: Array<{ id: number; role: string; chatId: string }>) {
    let table = 0;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => { table++; return chain; });
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => (table === 2 ? Promise.resolve([]) : table === 3 ? Promise.resolve(userRows) : chain));
    chain.limit = vi.fn(async () => (table === 1 ? [{ status: "active" }] : []));
    chain.insert = vi.fn(() => ({ values: vi.fn(async () => undefined) }));
    return chain;
  }

  it("просроченный долг: директору и агенту магазина, но не другим агентам", async () => {
    const sent: string[] = [];
    vi.doMock("../lib/telegram", async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async (chatId: string) => { sent.push(chatId); return true; }) }));
    vi.resetModules();
    const { notifyEvent: notify } = await import("../services/telegram-notify");
    const { getDb: db } = await import("../queries/connection");
    vi.mocked(db).mockReturnValue(fakeDb([
      { id: 1, role: "ceo", chatId: "c-ceo" },
      { id: 2, role: "agent", chatId: "c-a2" },
      { id: 3, role: "agent", chatId: "c-a3" },
    ]) as never);
    // День по Ташкенту: 12:00 — не тихие часы.
    const noon = new Date(Date.UTC(2026, 8, 16, 7, 0, 0));
    const r = await notify({ tenantId: 1, event: "debt.overdue", agentOnly: 2, text: "x", now: noon });
    expect(r.sent).toBe(2);
    expect(sent.sort()).toEqual(["c-a2", "c-ceo"]);
    vi.doUnmock("../lib/telegram");
    vi.resetModules();
  });
});

describe("карточки событий", () => {
  it("новый заказ называет агента, позиции, оплату словом и скидку", () => {
    const t = tgMessages.newOrder({ number: "ORD-01001", shop: "Олтин Дала", total: "598 500 сум", agent: "Эшмуродов Жасур", items: 7, payment: "cash", discountPct: 5 });
    expect(t).toContain("<b>Новый заказ ORD-01001</b>");
    expect(t).toContain("наличные");
    expect(t).toContain("скидка 5%");
    expect(t).toContain("Позиций: 7");
    expect(t).toContain("Эшмуродов Жасур");
  });

  it("ожидающий заказ говорит, где его подтвердить; недостача перечисляет строки", () => {
    expect(tgMessages.orderPending({ number: "1", shop: "s", total: "1", reason: "скидка 12%" })).toMatch(/Подтвердить или отклонить/);
    const t = tgMessages.pickingShort("ZL-1", [{ name: "Вода", required: 10, picked: 7, unit: "шт" }]);
    expect(t).toContain("Вода — 7 из 10 шт");
  });
});

describe("числа и время", () => {
  it("деньги — тысячи через пробел и валюта словом; количество без хвоста", () => {
    // Разряды — неразрывным пробелом: число в Telegram не переносится посередине.
    expect(fmtMoney(1234567.4).replace(new RegExp(String.fromCharCode(160), "g"), " ")).toBe("1 234 567 сум");
    expect(fmtMoney(0, "so'm")).toBe("0 so'm");
    expect(fmtQty("12.00")).toBe("12");
    expect(fmtQty(1.5)).toBe("1,5");
    expect(shortName("Эшмуродов Жасур Алиевич")).toBe("Эшмуродов Ж.");
    expect(shortName("Азиз")).toBe("Азиз");
  });

  it("сутки считаются по Ташкенту, а не по серверу", () => {
    // 15.09 22:30 UTC = 16.09 03:30 по Ташкенту → день уже 16-е.
    const at = new Date(Date.UTC(2026, 8, 15, 22, 30));
    expect(dayStr(at)).toBe("2026-09-16");
    expect(tashkentDayStart(at).toISOString()).toBe("2026-09-15T19:00:00.000Z");
    const r = periodRange("yesterday", at);
    expect(r.from.toISOString()).toBe("2026-09-14T19:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-15T19:00:00.000Z");
    expect(periodRange("week", at).from.toISOString()).toBe("2026-09-09T19:00:00.000Z");
  });
});

describe("расписание и кнопки", () => {
  it("утро уходит после конца тихих часов", () => {
    const sched = read("api/cron/scheduler.ts");
    const at = sched.indexOf('name: "telegram-morning"');
    expect(at).toBeGreaterThan(-1);
    const m = /daily: \{ hour: (\d+), minute: (\d+) \}/.exec(sched.slice(at, at + 300));
    expect(m, "у утреннего крона нет времени").not.toBeNull();
    expect(Number(m![1]) * 60 + Number(m![2])).toBeGreaterThanOrEqual(QUIET_TO * 60);
  });

  it("бот гасит нажатую кнопку и отвечает на срок сводки и «Ожидают»", () => {
    const bot = read("api/telegram/bot.ts");
    expect(bot).toContain("answerCallback(cb.id)");
    expect(bot).toMatch(/sum:\(today\|yesterday\|week\|month\)/);
    expect(bot).toContain('data === "pending"');
    // Меню — своё для роли: клавиатура строится от menuGroup.
    expect(bot).toContain("MENUS[menuGroup(role)]");
  });

  it("визиты считаются по статусу схемы, а не по несуществующему 'completed'", () => {
    const answers = read("api/telegram/answers.ts");
    expect(answers).not.toContain("'completed'");
    expect(answers).toContain("= 'visited'");
  });
});
