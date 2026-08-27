/**
 * Утечки и доступ: четыре находки аудита, каждая — про данные, которые
 * доставались тому, кому не должны.
 *
 * Проверки здесь поведенческие: они зовут процедуру или дёргают HTTP-маршрут и
 * смотрят на ответ. Тест, который ищет строку в исходнике, на старом коде не
 * падает — он подтверждает написанное, а не сделанное, и переживает любую
 * правку, которая переставит проверку в место, где та не работает.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { asTestContext } from "./helpers/test-context";

// Условия WHERE нужны разборчивыми: стенды ниже читают из них адрес и id
// пользователя, чтобы отвечать теми строками, о которых спросили, а не первой
// попавшейся. С настоящим drizzle условие — непрозрачный SQL-объект.
vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});

vi.mock("../lib/mailer", () => ({
  sendEmail:            vi.fn(async () => {}),
  sendInviteEmail:      vi.fn(async () => {}),
  sendTrialEndingEmail: vi.fn(async () => {}),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../auth/password", () => ({
  hashPassword:  vi.fn(async (p: string) => `hash_${p}`),
  verifyPassword: vi.fn(async () => false),
}));

let mockDb: any = null;
vi.mock("../queries/connection", () => ({ getDb: () => mockDb }));

vi.mock("../queries/tenants", () => ({
  findTenantBySlug: vi.fn(async () => null),
  findTenantById:   vi.fn(async () => null),
  listTenants:      vi.fn(async () => []),
}));

// ../lib/rate-limit НЕ подменяется намеренно. Находка про регистрацию — ровно
// в том, что настоящий лимитер получал ключ null (getClientIp без
// TRUSTED_PROXY_COUNT) и потому не ограничивал ничего. Подменённый лимитер
// этого не воспроизводит: он говорит «да» и на null, и на живой ключ.

import {
  apiKeys, tenants, users, orders, warehouseStock, dailyPlans, passwordResetTokens,
} from "@db/schema";
import { sendEmail } from "../lib/mailer";
import { hasSubscriptionAccess } from "../lib/feature-gating";

/** Значение из условия `eq(колонка, значение)` — с обходом вложенных and/or. */
function eqValue(cond: any, col: unknown): unknown {
  if (!cond || typeof cond !== "object") return undefined;
  if (cond.__kind === "eq" && cond.col === col) return cond.val;
  if (Array.isArray(cond.conds)) {
    for (const c of cond.conds) {
      const v = eqValue(c, col);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** Результат выборки: и сам по себе, и с `.limit(n)` — как у drizzle. */
function resultOf(rows: any[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. telegram.dailyDigest — выручка компании курьеру
// ═══════════════════════════════════════════════════════════════════════════

function makeDigestDb(rowsByTable: Map<unknown, any[]>) {
  return {
    select: () => {
      let table: unknown = null;
      const chain: any = {
        from(t: unknown) { table = t; return chain; },
        leftJoin() { return chain; },
        where() { return resultOf(rowsByTable.get(table) ?? []); },
      };
      return chain;
    },
  };
}

function ctxFor(role: string, userId: number) {
  return asTestContext({
    req:        new Request("http://localhost/trpc/telegram.dailyDigest"),
    resHeaders: new Headers(),
    user:  { id: userId, tenantId: 7, role, status: "active", name: "Тестовый", email: "t@x.uz" },
    tenant: { id: 7, slug: "t", name: "Тест", plan: "pro", status: "active" },
    db: mockDb,
  });
}

describe("дневной дайджест — сводка для руководства, а не для поля", () => {
  beforeEach(() => {
    const rows = new Map<unknown, any[]>();
    rows.set(orders,         [{ totalOrders: 12, completedOrders: 5, totalRevenue: "48500000.00" }]);
    rows.set(warehouseStock, [{ productName: "Мука в/с", available: "4.500" }]);
    rows.set(dailyPlans,     [{ total: 10, visited: 4 }]);
    mockDb = makeDigestDb(rows);
  });

  // Курьер — самый показательный случай: его роли нет ни в fieldSalesQuery, ни
  // в reportsQuery, то есть отчётов он не видит нигде, а дайджест отдавал ему
  // дневную выручку организации в сумах одним запросом.
  it.each([
    ["courier",      101],
    ["agent",        102],
    ["merchandiser", 103],
  ])("%s не получает дайджест вовсе", async (role, userId) => {
    const { telegramRouter } = await import("../telegram-router");
    const caller = telegramRouter.createCaller(ctxFor(role, userId));
    await expect(caller.dailyDigest()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    ["ceo",        111],
    ["operator",   112],
    ["supervisor", 113],
  ])("%s получает выручку, план и остатки", async (role, userId) => {
    const { telegramRouter } = await import("../telegram-router");
    const caller = telegramRouter.createCaller(ctxFor(role, userId));
    const digest = await caller.dailyDigest();

    expect(digest.stats.totalOrders).toBe(12);
    expect(digest.stats.totalRevenue).toBe(48_500_000);
    expect(digest.stats.planPct).toBe(40);
    expect(digest.text).toContain("Мука в/с");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Публичный REST API — ключ живёт дольше подписки
// ═══════════════════════════════════════════════════════════════════════════

const RAW_KEY = `wp_live_${"a1b2c3d4".repeat(6)}`;

function makeApiDb(keyRow: any, tenantRow: any) {
  return {
    select: () => {
      let table: unknown = null;
      const chain: any = {
        from(t: unknown) { table = t; return chain; },
        where() {
          if (table === apiKeys) return resultOf(keyRow ? [keyRow] : []);
          if (table === tenants) return resultOf(tenantRow ? [tenantRow] : []);
          return resultOf([]);
        },
      };
      return chain;
    },
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
}

const LIVE_KEY = { id: 1, tenantId: 7, status: "active", expiresAt: null, rateLimit: 5000, scopes: "read" };

async function callApi(path: string) {
  const { default: app } = await import("../public-api");
  return app.request(path, { headers: { Authorization: `Bearer ${RAW_KEY}` } });
}

describe("публичный REST API проверяет организацию, а не только ключ", () => {
  beforeEach(() => {
    vi.mocked(hasSubscriptionAccess).mockResolvedValue(true);
  });

  it("исправный ключ работающей организации на Exclusive пропускается", async () => {
    mockDb = makeApiDb(LIVE_KEY, { status: "active", plan: "exclusive" });
    const res = await callApi("/health");
    expect(res.status).toBe(200);
  });

  // Суперадмин отключил неплательщика: веб и мобилка закрылись, а ключ
  // продолжал отдавать заказы и остатки бессрочно.
  it("отключённая организация не отдаёт данные даже по живому ключу", async () => {
    mockDb = makeApiDb(LIVE_KEY, { status: "suspended", plan: "exclusive" });
    const res = await callApi("/products");
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.data).toBeUndefined();
  });

  it("истёкшая подписка отвечает 402, а не выдачей заказов", async () => {
    mockDb = makeApiDb(LIVE_KEY, { status: "active", plan: "exclusive" });
    vi.mocked(hasSubscriptionAccess).mockResolvedValue(false);
    const res = await callApi("/orders");
    expect(res.status).toBe(402);
    const body = await res.json() as any;
    expect(body.data).toBeUndefined();
  });

  // Ключ выписывается на любом тарифе (apiKey.create тариф не смотрит), значит
  // организация на trial заводила его и пользовалась API как купленным.
  it("ключ на тарифе trial не открывает API", async () => {
    mockDb = makeApiDb(LIVE_KEY, { status: "active", plan: "trial" });
    const res = await callApi("/stock");
    expect(res.status).toBe(403);
  });

  it("организация ключа удалена — доступа нет", async () => {
    mockDb = makeApiDb(LIVE_KEY, null);
    const res = await callApi("/shops");
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Публичная регистрация — перечисление адресов и отсутствующий лимит
// ═══════════════════════════════════════════════════════════════════════════

type RegisterState = {
  users: any[];
  createdTenants: any[];
};

function makeRegisterDb(state: RegisterState) {
  let nextId = 500;
  return {
    select: () => {
      let table: unknown = null;
      const chain: any = {
        from(t: unknown) { table = t; return chain; },
        where(cond: any) {
          if (table !== users) return resultOf([]);
          const email = String(eqValue(cond, users.email) ?? "").toLowerCase();
          return resultOf(
            state.users.filter(u => String(u.email).toLowerCase() === email).map(u => ({ id: u.id })),
          );
        },
      };
      return chain;
    },
    transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const tx = {
        insert: (t: unknown) => ({
          values(v: any) {
            const id = ++nextId;
            if (t === users)   state.users.push({ id, ...v });
            if (t === tenants) state.createdTenants.push({ id, ...v });
            return Promise.resolve([{ insertId: id }]);
          },
        }),
      };
      return fn(tx);
    },
  };
}

function publicCtx() {
  return asTestContext({
    req:        new Request("http://localhost/trpc/tenant.register"),
    resHeaders: new Headers(),
    user:   undefined,
    tenant: undefined,
    db: mockDb,
  });
}

async function registerCaller() {
  const { tenantRouter } = await import("../tenant-router");
  return tenantRouter.createCaller(publicCtx());
}

describe("публичная регистрация не отвечает, есть ли такой аккаунт", () => {
  let state: RegisterState;

  beforeEach(() => {
    vi.mocked(sendEmail).mockClear();
    state = { users: [], createdTenants: [] };
    mockDb = makeRegisterDb(state);
  });

  // Суть находки: по разнице ответов неаутентифицированный скрипт составлял
  // список сотрудников организаций-клиентов, у которых есть аккаунт.
  it("ответ на занятый адрес совпадает с ответом на свободный", async () => {
    state.users.push({ id: 1, email: "taken@shop.uz" });
    const caller = await registerCaller();

    const onFree  = await caller.register({
      orgName: "Zafar Savdo", name: "Владелец", email: "free@shop.uz", password: "password123",
    });
    const onTaken = await caller.register({
      orgName: "Zafar Savdo", name: "Владелец", email: "taken@shop.uz", password: "password123",
    });

    expect(onTaken).toEqual(onFree);
  });

  it("заявка на занятый адрес не заводит организацию", async () => {
    state.users.push({ id: 1, email: "busy@shop.uz" });
    const caller = await registerCaller();

    await caller.register({
      orgName: "Nur Trade", name: "Владелец", email: "busy@shop.uz", password: "password123",
    });

    expect(state.createdTenants).toHaveLength(0);
  });

  // Раз форма молчит, правду человек должен узнать из почты — иначе владелец
  // адреса будет ждать организацию, которой не появилось.
  it("владельцу занятого адреса уходит письмо о том, что аккаунт уже есть", async () => {
    state.users.push({ id: 1, email: "owner@shop.uz" });
    const caller = await registerCaller();

    await caller.register({
      orgName: "Oq Yo'l", name: "Владелец", email: "owner@shop.uz", password: "password123",
    });

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0][0].to).toBe("owner@shop.uz");
  });

  // Лимит считался по getClientIp, а тот отдаёт null, пока не задан
  // TRUSTED_PROXY_COUNT — то есть в деплое ограничения не было вовсе.
  it("шесть заявок с одного адреса подряд не проходят", async () => {
    const caller = await registerCaller();
    const shot = (i: number) => caller.register({
      orgName: `Firma ${i}`, name: "Владелец", email: "flood@shop.uz", password: "password123",
    });

    for (let i = 0; i < 5; i++) await shot(i);
    await expect(shot(5)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("шесть заявок на одно название организации подряд не проходят", async () => {
    const caller = await registerCaller();
    const shot = (i: number) => caller.register({
      orgName: "Bir Kompaniya", name: "Владелец", email: `org${i}@shop.uz`, password: "password123",
    });

    for (let i = 0; i < 5; i++) await shot(i);
    await expect(shot(5)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Сброс пароля — письмо, меняющее пароль чужому аккаунту
// ═══════════════════════════════════════════════════════════════════════════

type ResetState = {
  users: any[];
  tenants: any[];
  tokens: any[];
};

function makeResetDb(state: ResetState) {
  let nextId = 900;
  return {
    select: () => {
      let table: unknown = null;
      let joinedTenants = false;
      const chain: any = {
        from(t: unknown) { table = t; return chain; },
        leftJoin(t: unknown) { if (t === tenants) joinedTenants = true; return chain; },
        where(cond: any) {
          if (table === users) {
            const email = eqValue(cond, users.email);
            return resultOf(state.users.filter(u => u.email === email).map(u => ({
              id: u.id, name: u.name, tenantId: u.tenantId,
              orgName: joinedTenants
                ? (state.tenants.find(t => t.id === u.tenantId)?.name ?? null)
                : null,
            })));
          }
          if (table === passwordResetTokens) {
            const userId = eqValue(cond, passwordResetTokens.userId);
            return resultOf(state.tokens.filter(t => t.userId === userId).map(t => ({ count: t.id })));
          }
          return resultOf([]);
        },
      };
      return chain;
    },
    insert: (t: unknown) => ({
      values(v: any) {
        const id = ++nextId;
        if (t === passwordResetTokens) state.tokens.push({ id, ...v });
        return Promise.resolve([{ insertId: id }]);
      },
    }),
  };
}

/**
 * Расстановка из находки: руководитель организации B завёл своему курьеру
 * адрес директора организации A — проверка уникальности внутри B это
 * пропускает. Дальше директор A жмёт «забыли пароль».
 */
function twoOrgsSharingEmail(orgBName = "Organizatsiya B"): ResetState {
  return {
    users: [
      { id: 11, tenantId: 1, name: "Директор A", email: "dir@shop.uz" },
      { id: 22, tenantId: 2, name: "Курьер B",   email: "dir@shop.uz" },
    ],
    tenants: [
      { id: 1, name: "Organizatsiya A" },
      { id: 2, name: orgBName },
    ],
    tokens: [],
  };
}

describe("сброс пароля не путает аккаунты с одинаковым адресом", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockClear();
  });

  // Было: LIMIT 1 без ORDER BY, то есть произвольная строка из двух. Токен мог
  // уйти на курьера организации B, и директор A, перейдя по ссылке из своего
  // письма, менял пароль чужому человеку.
  it("токен выпускается на каждый аккаунт с этим адресом", async () => {
    const state = twoOrgsSharingEmail();
    const { requestPasswordReset } = await import("../services/password-reset");

    await requestPasswordReset(makeResetDb(state) as any, "dir@shop.uz", "https://app.example");

    expect(state.tokens.map(t => t.userId).sort()).toEqual([11, 22]);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2);
  });

  it("в письме названа организация — иначе не понять, какую ссылку открывать", async () => {
    const state = twoOrgsSharingEmail();
    const { requestPasswordReset } = await import("../services/password-reset");

    await requestPasswordReset(makeResetDb(state) as any, "dir@shop.uz", "https://app.example");

    const bodies = vi.mocked(sendEmail).mock.calls.map(c => c[0].html);
    expect(bodies.some(h => h.includes("Organizatsiya A"))).toBe(true);
    expect(bodies.some(h => h.includes("Organizatsiya B"))).toBe(true);
  });

  // Название организации приходит с публичной формы регистрации, то есть его
  // пишет кто угодно. Без экранирования оно стало бы настоящей ссылкой внутри
  // письма, отправленного доверенным адресом платформы.
  it("название организации попадает в письмо как текст, а не как разметка", async () => {
    const state = twoOrgsSharingEmail('<a href="https://evil.uz">Ваш банк</a>');
    const { requestPasswordReset } = await import("../services/password-reset");

    await requestPasswordReset(makeResetDb(state) as any, "dir@shop.uz", "https://app.example");

    const bodies = vi.mocked(sendEmail).mock.calls.map(c => c[0].html);
    expect(bodies.some(h => h.includes("&lt;a href="))).toBe(true);
    expect(bodies.some(h => h.includes('<a href="https://evil.uz"'))).toBe(false);
  });

  // Лимит на аккаунт, а не на адрес: иначе три запроса по одному аккаунту
  // закрывали бы восстановление владельцу второго.
  it("исчерпанный лимит одного аккаунта не лишает второй письма", async () => {
    const state = twoOrgsSharingEmail();
    state.tokens = [1, 2, 3].map(id => ({ id, userId: 11, createdAt: new Date() }));
    const { requestPasswordReset } = await import("../services/password-reset");

    await requestPasswordReset(makeResetDb(state) as any, "dir@shop.uz", "https://app.example");

    expect(state.tokens.filter(t => t.userId === 22)).toHaveLength(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
  });

  it("неизвестный адрес по-прежнему отвечает успехом и ничего не создаёт", async () => {
    const state = twoOrgsSharingEmail();
    const { requestPasswordReset } = await import("../services/password-reset");

    const res = await requestPasswordReset(makeResetDb(state) as any, "nobody@shop.uz", "https://app.example");

    expect(res).toEqual({ success: true });
    expect(state.tokens).toHaveLength(0);
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });
});
