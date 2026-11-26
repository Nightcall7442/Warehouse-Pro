import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Бот молчит о данных организации, у которой закрыт доступ.
 *
 * Бизнес-аудит 19.11.2026, п. 26: вебхук бота — отдельный маршрут, мимо
 * калитки подписки сайта и мобилки. findByChat смотрел только на статус
 * сотрудника, и после конца подписки или приостановки организации директор
 * и агенты продолжали получать в Telegram выручку, долги и остатки.
 */
const { sent, state } = vi.hoisted(() => ({
  sent: [] as Array<[string, string]>,
  state: { tenantStatus: "active", access: true, answered: 0 },
}));
vi.mock("../lib/env", () => ({ env: { appSecret: "s", appUrl: "https://x", telegramBotToken: "t", telegramWebhookSecret: "hook", telegramAdminChatId: "777" } }));
vi.mock("../lib/telegram", () => ({
  sendTelegram: vi.fn(async (chat: string, text: string) => { sent.push([chat, text]); return true; }),
  tgEscape: (v: unknown) => String(v ?? ""),
  answerCallback: vi.fn(async () => undefined),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("../lib/feature-gating", () => ({ hasSubscriptionAccess: vi.fn(async () => state.access) }));
vi.mock("../queries/connection", () => {
  const row = () => ({ id: 40, tenantId: 14, name: "Директор", role: "ceo", lang: "ru", plan: "standard", brand: "Fresh", status: "active", tenantStatus: state.tenantStatus });
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) c[k] = () => c;
    c.limit = async () => [row()];
    c.then = (res: (v: unknown) => unknown) => Promise.resolve([row()]).then(res);
    return c;
  };
  return { getDb: () => ({ select: () => chain(), update: () => ({ set: () => ({ where: async () => undefined }) }) }) };
});
vi.mock("../telegram/answers", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const stub = async () => { state.answered++; return { text: "ДАННЫЕ ОРГАНИЗАЦИИ" }; };
  return Object.fromEntries(Object.entries(real).map(([k, v]) => [k, typeof v === "function" && /^answer|Summary$/.test(k) ? stub : v]));
});

const { telegramBot } = await import("../telegram/bot");
const { T } = await import("../telegram/texts");

const post = (body: unknown) => telegramBot.request(new Request("http://x/api/webhooks/telegram", {
  method: "POST",
  headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "hook" },
  body: JSON.stringify(body),
}));
const message = (text: string) => post({ message: { chat: { id: 5001, type: "private" }, text } });

beforeEach(() => { sent.length = 0; state.tenantStatus = "active"; state.access = true; state.answered = 0; });

describe("бот и закрытый доступ организации", () => {
  it("подписка кончилась — вместо данных объяснение, данные не считаются", async () => {
    state.access = false;
    expect((await message("📊 Сводка")).status).toBe(200);
    expect(sent.at(-1)?.[1]).toBe(T.accessClosed.ru);
    expect(state.answered).toBe(0);
  });

  it("организация приостановлена — так же, даже при оплаченной подписке", async () => {
    state.tenantStatus = "suspended";
    await message("💰 Долги");
    expect(sent.at(-1)?.[1]).toBe(T.accessClosed.ru);
    expect(state.answered).toBe(0);
  });

  it("кнопка под старым сообщением при закрытом доступе ничего не отвечает", async () => {
    state.access = false;
    expect((await post({ callback_query: { id: "cb1", data: "sum:today", message: { chat: { id: 5001 } } } })).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(state.answered).toBe(0);
  });

  it("доступ открыт — бот отвечает как раньше", async () => {
    await message("📊 Сводка");
    expect(sent.at(-1)?.[1]).not.toBe(T.accessClosed.ru);
  });
});
