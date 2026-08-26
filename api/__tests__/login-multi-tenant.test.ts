import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Вход, когда один адрес заведён в нескольких организациях.
 *
 * ── Что было сломано ────────────────────────────────────────────────────────
 *
 * Схема прямо разрешает повтор адреса между организациями: уникальность стоит
 * на паре email + tenant_id, с комментарием «email уникален внутри тенанта, но
 * может повторяться в разных». А вход брал ОДНУ строку — с наименьшим id — и
 * сверял пароль только с ней.
 *
 * Значит, второй человек с тем же адресом не мог войти НИКОГДА: его
 * правильный пароль сверялся с чужим хешем и, разумеется, не подходил. Ответ
 * приходил обычный — «Неверный email или пароль», — поэтому со стороны это
 * выглядело как забытый пароль. Сброс пароля тоже не помогал: новый хеш
 * ложился в строку, которую вход и не читал. Такую учётную запись нельзя было
 * починить ничем, кроме смены адреса.
 *
 * Сейчас дублей в базе нет (64 адреса на 64 записи), то есть это ловушка, а не
 * пожар: она захлопнется на первом же человеке, которого заведут в двух
 * организациях — например, на владельце сети, работающем сразу с двумя
 * юрлицами.
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 *
 * Пароль сверяется со всеми записями по этому адресу. У разных людей пароли
 * разные, поэтому почти всегда подходит ровно одна — и вход проходит молча,
 * как раньше. Если подошло несколько, выбрать за человека нельзя: организации
 * разные, и молчаливый выбор пустил бы не туда. Тогда приходит 409 со списком,
 * и клиент повторяет запрос с tenantId.
 */

const users = vi.hoisted(() => ({ rows: [] as any[] }));
const tenants = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock("../queries/users", () => ({
  findUserById:              vi.fn(),
  findUserByIdWithPassword:  vi.fn(),
  findUserByEmail:           vi.fn(),
  createUser:                vi.fn(),
  updateUserLastSignIn:      vi.fn(async () => {}),
  findUsersByEmailAnyTenant: vi.fn(async (email: string) =>
    users.rows.filter(u => u.email === email).sort((a, b) => a.id - b.id)),
}));

vi.mock("../queries/tenants", () => ({
  findTenantById:   vi.fn(async (id: number) => tenants.rows.find(t => t.id === id) ?? null),
  findTenantBySlug: vi.fn(),
  createTenant:     vi.fn(),
  listTenants:      vi.fn(),
}));

vi.mock("../auth/session", () => ({
  signSessionToken:   vi.fn(async () => "тестовый-токен"),
  verifySessionToken: vi.fn(async () => null),
}));

import app from "../boot";
import { hashPassword } from "../auth/password";
import { Session } from "@contracts/constants";

type Row = { id: number; tenantId: number; email: string; password: string; status?: string };

/** Пароли хешируются по-настоящему: с подменённым verifyPassword тест проверял бы подмену. */
async function seed(rows: Row[], orgs: Array<{ id: number; name: string; status?: string }>) {
  users.rows = await Promise.all(rows.map(async r => ({
    id: r.id,
    tenantId: r.tenantId,
    email: r.email,
    name: `Пользователь ${r.id}`,
    role: "admin",
    status: r.status ?? "active",
    tokenVersion: 0,
    passwordHash: await hashPassword(r.password),
  })));
  tenants.rows = orgs.map(o => ({ ...o, slug: `org-${o.id}`, status: o.status ?? "active" }));
}

async function login(body: Record<string, unknown>) {
  const res = await app.request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any, cookie: res.headers.get("set-cookie") };
}

beforeEach(() => {
  users.rows = [];
  tenants.rows = [];
});

describe("вход при одном адресе в нескольких организациях", () => {
  it("пускает того, чья запись НЕ первая по id — раньше это было невозможно", async () => {
    await seed(
      [
        { id: 10, tenantId: 1, email: "chef@example.com", password: "первый-пароль" },
        { id: 20, tenantId: 2, email: "chef@example.com", password: "второй-пароль" },
      ],
      [{ id: 1, name: "Организация А" }, { id: 2, name: "Организация Б" }],
    );

    const second = await login({ email: "chef@example.com", password: "второй-пароль" });

    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(20);
  });

  it("первого при этом пускает по-прежнему", async () => {
    await seed(
      [
        { id: 10, tenantId: 1, email: "chef@example.com", password: "первый-пароль" },
        { id: 20, tenantId: 2, email: "chef@example.com", password: "второй-пароль" },
      ],
      [{ id: 1, name: "Организация А" }, { id: 2, name: "Организация Б" }],
    );

    const first = await login({ email: "chef@example.com", password: "первый-пароль" });

    expect(first.status).toBe(200);
    expect(first.body.user.id).toBe(10);
  });

  it("когда пароль подошёл к нескольким — спрашивает, а не выбирает молча", async () => {
    await seed(
      [
        { id: 10, tenantId: 1, email: "owner@example.com", password: "общий-пароль" },
        { id: 20, tenantId: 2, email: "owner@example.com", password: "общий-пароль" },
      ],
      [{ id: 1, name: "Оптовая база" }, { id: 2, name: "Розничная сеть" }],
    );

    const res = await login({ email: "owner@example.com", password: "общий-пароль" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TENANT_REQUIRED");
    expect(res.body.organizations).toEqual([
      { tenantId: 1, name: "Оптовая база" },
      { tenantId: 2, name: "Розничная сеть" },
    ]);
    // Сессия не выдана: выбор ещё не сделан. (CSRF-кука ставится на любой
    // ответ, поэтому смотрим именно на сессионную.)
    expect(res.cookie ?? "").not.toContain(Session.cookieName);
  });

  it("повтор с выбранной организацией пускает именно в неё", async () => {
    await seed(
      [
        { id: 10, tenantId: 1, email: "owner@example.com", password: "общий-пароль" },
        { id: 20, tenantId: 2, email: "owner@example.com", password: "общий-пароль" },
      ],
      [{ id: 1, name: "Оптовая база" }, { id: 2, name: "Розничная сеть" }],
    );

    const res = await login({ email: "owner@example.com", password: "общий-пароль", tenantId: 2 });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(20);
    expect(res.cookie).toContain("HttpOnly");
  });

  it("подставленный tenantId чужой организации не пускает никуда", async () => {
    // Пароль подошёл к 1 и 2, а просят 3 — там этот пароль не подходит.
    await seed(
      [
        { id: 10, tenantId: 1, email: "owner@example.com", password: "общий-пароль" },
        { id: 20, tenantId: 2, email: "owner@example.com", password: "общий-пароль" },
        { id: 30, tenantId: 3, email: "owner@example.com", password: "чужой-пароль" },
      ],
      [{ id: 1, name: "Оптовая база" }, { id: 2, name: "Розничная сеть" }, { id: 3, name: "Чужая фирма" }],
    );

    const res = await login({ email: "owner@example.com", password: "общий-пароль", tenantId: 3 });

    expect(res.status).toBe(409);
    expect(res.body.organizations.map((o: any) => o.tenantId)).toEqual([1, 2]);
  });

  it("отключённую запись не предлагает выбрать", async () => {
    await seed(
      [
        { id: 10, tenantId: 1, email: "owner@example.com", password: "общий-пароль" },
        { id: 20, tenantId: 2, email: "owner@example.com", password: "общий-пароль", status: "disabled" },
      ],
      [{ id: 1, name: "Оптовая база" }, { id: 2, name: "Розничная сеть" }],
    );

    // Живая запись осталась одна — спрашивать не о чем, это обычный вход.
    const res = await login({ email: "owner@example.com", password: "общий-пароль" });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(10);
  });
});

describe("вход в остальных случаях не изменился", () => {
  it("неверный пароль — отказ", async () => {
    await seed(
      [{ id: 10, tenantId: 1, email: "single@example.com", password: "правильный" }],
      [{ id: 1, name: "Организация А" }],
    );

    const res = await login({ email: "single@example.com", password: "неправильный" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Неверный email или пароль");
  });

  it("несуществующий адрес отвечает тем же текстом, что и неверный пароль", async () => {
    // Иначе перебором адресов узнают, кто здесь зарегистрирован.
    await seed(
      [{ id: 10, tenantId: 1, email: "single@example.com", password: "правильный" }],
      [{ id: 1, name: "Организация А" }],
    );

    const unknown = await login({ email: "нет-такого@example.com", password: "правильный" });
    const wrongPw = await login({ email: "single@example.com", password: "неправильный" });

    expect(unknown.status).toBe(wrongPw.status);
    expect(unknown.body).toEqual(wrongPw.body);
  });

  it("единственная отключённая запись не пускает", async () => {
    await seed(
      [{ id: 10, tenantId: 1, email: "off@example.com", password: "правильный", status: "disabled" }],
      [{ id: 1, name: "Организация А" }],
    );

    const res = await login({ email: "off@example.com", password: "правильный" });

    expect(res.status).toBe(401);
  });

  it("не пускает, когда организация приостановлена", async () => {
    await seed(
      [{ id: 10, tenantId: 1, email: "susp@example.com", password: "правильный" }],
      [{ id: 1, name: "Организация А", status: "suspended" }],
    );

    const res = await login({ email: "susp@example.com", password: "правильный" });

    expect(res.status).toBe(401);
  });
});
