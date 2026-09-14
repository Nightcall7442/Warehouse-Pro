import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /manual в Telegram — только владельцу платформы.
 *
 * Команда выдаёт платное руководство организации и показывает их список.
 * Отвечать на неё кому-то кроме чата из TELEGRAM_ADMIN_CHAT_ID нельзя: список
 * организаций — не публичная информация, а выдача — деньги.
 */
const { sent, db } = vi.hoisted(() => ({
  sent: [] as Array<[string, string]>,
  db: { tenants: [{ id: 5, slug: "alfa", name: "Альфа", manualEnabledAt: null as Date | null }, { id: 6, slug: "beta", name: "Бета", manualEnabledAt: new Date("2026-09-01") }], selects: 0 },
}));
vi.mock("../lib/env", () => ({ env: { appSecret: "s", appUrl: "https://x", telegramBotToken: "t", telegramWebhookSecret: "hook", telegramAdminChatId: "777" } }));
vi.mock("../lib/telegram", () => ({ sendTelegram: vi.fn(async (chat: string, text: string) => { sent.push([chat, text]); return true; }), tgEscape: (v: unknown) => String(v ?? "") }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("drizzle-orm", async (orig) => ({ ...(await orig<typeof import("drizzle-orm")>()), eq: (_c: unknown, v: unknown) => ({ v }), ne: () => ({}), and: () => ({}) }));
vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (cond: { v?: unknown }) => {
          db.selects++;
          const rows = cond?.v === undefined ? db.tenants : db.tenants.filter(t => t.id === cond.v || t.slug === cond.v);
          return Object.assign(Promise.resolve(rows), { limit: async () => rows.slice(0, 1), orderBy: async () => rows });
        },
      }),
    }),
    update: () => ({ set: (v: { manualEnabledAt: Date | null }) => ({ where: async (cond: { v: unknown }) => { const t = db.tenants.find(x => x.id === cond.v); if (t) t.manualEnabledAt = v.manualEnabledAt; } }) }),
  }),
}));
vi.mock("../services/audit-log", () => ({ recordAudit: vi.fn(async () => undefined), auditActor: () => ({}) }));
vi.mock("../auth", () => ({ invalidateAuthTenant: vi.fn() }));

const { telegramBot } = await import("../telegram/bot");

function update(chatId: string, text: string) {
  return telegramBot.request(new Request("http://x/api/webhooks/telegram", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "hook" },
    body: JSON.stringify({ message: { chat: { id: Number(chatId), type: "private" }, text } }),
  }));
}

beforeEach(() => { sent.length = 0; db.selects = 0; });

describe("/manual в Telegram", () => {
  it("владельцу — список организаций с отметкой, у кого руководство есть", async () => {
    expect((await update("777", "/manual")).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("777");
    expect(sent[0][1]).toContain("▫️ <code>alfa</code>");
    expect(sent[0][1]).toContain("✅ <code>beta</code>");
  });

  it("выдать и забрать по slug; журнал и кэш сессии — через общую дверь", async () => {
    await update("777", "/manual alfa on");
    expect(db.tenants[0].manualEnabledAt).toBeInstanceOf(Date);
    expect(sent.at(-1)?.[1]).toMatch(/Альфа: руководство выдано/);
    await update("777", "/manual 5 off");
    expect(db.tenants[0].manualEnabledAt).toBeNull();
    expect(sent.at(-1)?.[1]).toMatch(/Альфа: руководство отключено/);
    const { invalidateAuthTenant } = await import("../auth");
    expect(vi.mocked(invalidateAuthTenant)).toHaveBeenCalledWith(5);
  });

  it("неизвестная организация и кривой формат — понятный ответ, ничего не меняется", async () => {
    await update("777", "/manual gamma on");
    expect(sent.at(-1)?.[1]).toContain("нет");
    await update("777", "/manual alfa maybe");
    expect(sent.at(-1)?.[1]).toContain("Формат");
    expect(db.tenants[0].manualEnabledAt).toBeNull();
  });

  it("чужому чату — ни ответа, ни запроса к базе", async () => {
    expect((await update("123", "/manual")).status).toBe(200);
    await update("123", "/manual alfa on");
    expect(sent).toEqual([]);
    expect(db.selects).toBe(0);
    expect(db.tenants[0].manualEnabledAt).toBeNull();
  });

  it("имя бота после команды не мешает: /manual@wpapp_bot", async () => {
    await update("777", "/manual@wpapp_bot alfa on");
    expect(db.tenants[0].manualEnabledAt).toBeInstanceOf(Date);
    db.tenants[0].manualEnabledAt = null;
  });
});
